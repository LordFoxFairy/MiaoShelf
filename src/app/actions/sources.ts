"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import {
  createSourceAccount,
  loadCredentials,
  markSessionStatus,
  saveSession,
  updateSourceAccount,
} from "@/lib/source-credentials";
import { connectorForAccount } from "@/lib/connectors";
import { loginToLdxp } from "@/lib/connectors/ldxp/login";
import {
  loginWithPassword,
  LDXP_AUTH_BASE,
} from "@/lib/connectors/ldxp/auth";
import { parseShopUrl } from "@/lib/connectors/ldxp-shop/connector";
import { sourceAccountCreateSchema } from "@/lib/schemas";
import { safeErrorDetail } from "@/lib/connectors/normalize";

/**
 * 货源账号管理（spec §17.2、§20）。
 * 每个 action 都先校验管理员身份 —— Server Action 是公开端点。
 */

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function requireAdmin(): Promise<void> {
  const session = await readSession();
  if (!session) throw new Error("未登录");
}

export async function createAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const provider =
    formData.get("provider") === "LDXP_SHOP" ? "LDXP_SHOP" : "LDXP_MERCHANT";

  // 公开店铺只需要地址；商家后台才要账号密码。
  const schema =
    provider === "LDXP_SHOP"
      ? z.object({
          name: z.string().trim().min(1).max(80),
          baseUrl: z
            .string()
            .url()
            .refine(
              (value) => parseShopUrl(value) !== null,
              "地址里找不到店铺标识，应形如 https://pay.ldxp.cn/shop/你的店铺名",
            ),
        })
      : sourceAccountCreateSchema;

  const parsed = schema.safeParse({
    name: formData.get("name"),
    baseUrl: formData.get("baseUrl"),
    ...(provider === "LDXP_MERCHANT"
      ? {
          username: formData.get("username"),
          password: formData.get("password"),
          isEnabled: true,
        }
      : {}),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  const account = await createSourceAccount({ ...parsed.data, provider });
  revalidatePath("/admin/sources");

  if (provider === "LDXP_SHOP") {
    // 公开店铺无需登录，直接验证一次让用户马上知道能不能用。
    const check = await verifyAccountAction(account.id);
    return check.ok
      ? { ok: true, message: `店铺已连接${check.message ? `（${check.message}）` : ""}，可以开始导入商品了。` }
      : { ok: true, message: `店铺已创建，但连接测试失败：${check.error}` };
  }

  return { ok: true, message: "账号已创建，接下来点「登录」建立会话。" };
}

export async function updateAccountAction(
  accountId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const schema = z.object({
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().url(),
    username: z.string().trim().max(200).optional(),
    // 留空 = 不修改密码
    password: z.string().max(200).optional(),
  });

  const parsed = schema.safeParse({
    name: formData.get("name"),
    baseUrl: formData.get("baseUrl"),
    username: formData.get("username") || undefined,
    password: formData.get("password") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  await updateSourceAccount(accountId, parsed.data);
  revalidatePath("/admin/sources");
  return { ok: true, message: "已保存" };
}

/**
 * 登录货源账号。
 *
 * 两条路径，优先走前者：
 *  1. HTTP 登录 —— 平台有真正的账号密码接口，几秒完成，无需浏览器
 *  2. Playwright —— HTTP 路径失败时的兜底（站点改版等）
 *
 * 任何一条遇到验证码/安全验证都立即停止，转由管理员手动导入会话。
 */
export async function loginAccountAction(
  accountId: string,
): Promise<ActionState> {
  await requireAdmin();

  const credentials = await loadCredentials(accountId);
  if (!credentials) return { error: "账号不存在" };

  if (!credentials.username || !credentials.password) {
    return { error: "请先填写登录账号和密码" };
  }

  try {
    const result = await loginWithPassword({
      baseUrl: LDXP_AUTH_BASE,
      username: credentials.username,
      password: credentials.password,
    });

    if (result.status === "SUCCESS") {
      await saveSession(accountId, {
        cookie: result.cookie,
        merchantToken: result.merchantToken,
      });
      revalidatePath("/admin/sources");
      return {
        ok: true,
        message: result.nickname
          ? `登录成功（${result.nickname}），会话已保存。`
          : "登录成功，会话已保存。",
      };
    }

    if (result.status === "NEEDS_VERIFICATION") {
      // 需要人工验证就停，不重试、不绕过。
      await markSessionStatus(accountId, "NEEDS_VERIFICATION", result.message);
      revalidatePath("/admin/sources");
      return { error: result.message };
    }

    // HTTP 登录失败，回落到浏览器登录。
    return await loginViaBrowser(accountId, credentials, result.message);
  } catch (error) {
    const message = safeErrorDetail(
      error instanceof Error ? error.message : String(error),
    );
    await markSessionStatus(accountId, "ERROR", message);
    revalidatePath("/admin/sources");
    return { error: `登录失败：${message}` };
  }
}

/** 浏览器兜底登录。需要服务器上装了 Playwright 的 Chromium。 */
async function loginViaBrowser(
  accountId: string,
  credentials: { baseUrl: string; username?: string | null; password?: string | null },
  httpError: string,
): Promise<ActionState> {
  const profileRoot =
    process.env.PLAYWRIGHT_PROFILE_ROOT ?? "./data/browser-profiles";

  try {
    const outcome = await loginToLdxp({
      baseUrl: credentials.baseUrl,
      username: credentials.username ?? "",
      password: credentials.password ?? "",
      profilePath: `${profileRoot}/${accountId}`,
      headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
    });

    if (outcome.status === "SUCCESS") {
      await saveSession(accountId, {
        cookie: outcome.cookie,
        merchantToken: outcome.merchantToken,
      });
      await prisma.sourceAccount.update({
        where: { id: accountId },
        data: { browserProfilePath: `${profileRoot}/${accountId}` },
      });
      revalidatePath("/admin/sources");
      return { ok: true, message: "登录成功（浏览器方式），会话已保存。" };
    }

    const status =
      outcome.status === "NEEDS_VERIFICATION" ? "NEEDS_VERIFICATION" : "ERROR";
    await markSessionStatus(accountId, status, outcome.message);
    revalidatePath("/admin/sources");
    return { error: outcome.message };
  } catch {
    // 服务器没装 Chromium 时会走到这里，报原始的 HTTP 错误更有用。
    await markSessionStatus(accountId, "ERROR", httpError);
    revalidatePath("/admin/sources");
    return {
      error: `${httpError}（浏览器兜底也不可用，可改用手动导入 Cookie）`,
    };
  }
}

/** 手动导入会话（验证码场景的兜底，spec §10.3）。 */
export async function importSessionAction(
  accountId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const cookie = String(formData.get("cookie") ?? "").trim();
  const merchantToken = String(formData.get("merchantToken") ?? "").trim();

  if (!cookie && !merchantToken) {
    return { error: "请至少填写 Cookie 或 Merchant-Token" };
  }

  await saveSession(accountId, {
    cookie,
    merchantToken: merchantToken || null,
  });

  // 立刻验证一次，避免存进去的是过期会话。
  const result = await verifyAccountAction(accountId);
  revalidatePath("/admin/sources");

  return result.ok
    ? { ok: true, message: "会话已导入并验证通过。" }
    : { error: `会话已保存，但验证失败：${result.error}` };
}

/** 测试连接。 */
export async function verifyAccountAction(
  accountId: string,
): Promise<ActionState> {
  await requireAdmin();

  try {
    const connector = await connectorForAccount(accountId);
    if (!connector) return { error: "账号不存在或凭据无法解密" };

    const check = await connector.verifySession();

    if (check.valid) {
      await markSessionStatus(accountId, "CONNECTED");
      revalidatePath("/admin/sources");
      return { ok: true, message: "连接正常" };
    }

    await markSessionStatus(
      accountId,
      check.needsVerification ? "NEEDS_VERIFICATION" : "AUTH_REQUIRED",
      check.message,
    );
    revalidatePath("/admin/sources");
    return { error: check.message ?? "会话已失效，请重新登录" };
  } catch (error) {
    const message = safeErrorDetail(
      error instanceof Error ? error.message : String(error),
    );
    await markSessionStatus(accountId, "ERROR", message);
    revalidatePath("/admin/sources");
    return { error: message };
  }
}

export async function toggleAccountAction(
  accountId: string,
  enabled: boolean,
): Promise<ActionState> {
  await requireAdmin();

  await prisma.sourceAccount.update({
    where: { id: accountId },
    data: { isEnabled: enabled },
  });
  revalidatePath("/admin/sources");
  return { ok: true };
}

/**
 * 删除账号。
 * 级联删除它的所有货源商品；展示商品会保留（sourceProductId 置 null），
 * 避免误删你已经编辑好的展示内容。
 */
export async function deleteAccountAction(
  accountId: string,
): Promise<ActionState> {
  await requireAdmin();

  await prisma.sourceAccount.delete({ where: { id: accountId } });
  revalidatePath("/admin/sources");
  revalidatePath("/admin/products");
  return { ok: true, message: "账号已删除" };
}
