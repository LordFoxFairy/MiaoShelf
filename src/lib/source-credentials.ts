import { prisma } from "@/lib/db";
import { encryptSecret, tryDecryptSecret } from "@/lib/crypto";
import type { ConnectorCredentials } from "@/lib/connectors/types";
import type { SessionStatus } from "@/lib/enums";

/**
 * 货源账号凭据的读写。
 *
 * 铁律：明文只在这个模块和 Connector 内部存在。
 *  - 存库前一律 AES-256-GCM 加密
 *  - 绝不返回给浏览器（哪怕是管理员）
 *  - 绝不写日志
 *
 * 所以对外只暴露两类函数：给 Connector 用的（含明文）和给 UI 用的（已脱敏）。
 */

function masterKey(): string {
  const key = process.env.CREDENTIAL_MASTER_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      "CREDENTIAL_MASTER_KEY 缺失或过短（至少 32 位）。请用 openssl rand -base64 32 生成。",
    );
  }
  return key;
}

export interface SaveAccountInput {
  name: string;
  baseUrl: string;
  provider?: string;
  username?: string;
  password?: string;
  isEnabled?: boolean;
}

export async function createSourceAccount(input: SaveAccountInput) {
  const key = masterKey();
  const provider = input.provider ?? "LDXP_MERCHANT";

  // 公开店铺不需要凭据，创建即可用。
  const isPublicShop = provider === "LDXP_SHOP";

  return prisma.sourceAccount.create({
    data: {
      name: input.name,
      provider,
      // 店铺地址要保留 /shop/xxx 路径，不能像平台地址那样截断。
      baseUrl: isPublicShop
        ? input.baseUrl.trim()
        : input.baseUrl.replace(/\/+$/, ""),
      encryptedUsername: input.username
        ? encryptSecret(input.username, key)
        : null,
      encryptedPassword: input.password
        ? encryptSecret(input.password, key)
        : null,
      sessionStatus: isPublicShop ? "CONNECTED" : "DISCONNECTED",
      isEnabled: input.isEnabled ?? true,
    },
  });
}

export async function updateSourceAccount(
  id: string,
  input: Partial<SaveAccountInput>,
) {
  const key = masterKey();

  return prisma.sourceAccount.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.baseUrl !== undefined
        ? { baseUrl: input.baseUrl.replace(/\/+$/, "") }
        : {}),
      ...(input.username !== undefined
        ? { encryptedUsername: encryptSecret(input.username, key) }
        : {}),
      // 密码留空表示"不修改"，而不是"清空"——否则编辑账号名会误删密码。
      ...(input.password
        ? { encryptedPassword: encryptSecret(input.password, key) }
        : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
    },
  });
}

/** 供 Connector 使用：解密出明文凭据。调用方不得把结果写日志。 */
export async function loadCredentials(
  accountId: string,
): Promise<ConnectorCredentials | null> {
  const account = await prisma.sourceAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) return null;

  const key = masterKey();
  return {
    baseUrl: account.baseUrl,
    username: tryDecryptSecret(account.encryptedUsername, key),
    password: tryDecryptSecret(account.encryptedPassword, key),
    cookie: tryDecryptSecret(account.encryptedCookie, key),
    token: tryDecryptSecret(account.encryptedMerchantToken, key),
  };
}

/** 登录成功后保存会话。 */
export async function saveSession(
  accountId: string,
  session: { cookie: string; merchantToken?: string | null },
): Promise<void> {
  const key = masterKey();

  await prisma.sourceAccount.update({
    where: { id: accountId },
    data: {
      encryptedCookie: encryptSecret(session.cookie, key),
      encryptedMerchantToken: session.merchantToken
        ? encryptSecret(session.merchantToken, key)
        : null,
      sessionStatus: "CONNECTED",
      lastAuthAt: new Date(),
      lastVerifiedAt: new Date(),
      lastError: null,
    },
  });
}

export async function markSessionStatus(
  accountId: string,
  status: SessionStatus,
  error?: string | null,
): Promise<void> {
  await prisma.sourceAccount.update({
    where: { id: accountId },
    data: {
      sessionStatus: status,
      lastError: error ?? null,
      ...(status === "CONNECTED" ? { lastVerifiedAt: new Date() } : {}),
    },
  });
}

/**
 * 给 UI 用的账号信息 —— 已脱敏。
 * 只告诉前端"配了没有"，绝不回传值本身。
 */
export interface SafeSourceAccount {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  sessionStatus: SessionStatus;
  isEnabled: boolean;
  hasUsername: boolean;
  hasPassword: boolean;
  hasCookie: boolean;
  hasToken: boolean;
  lastAuthAt: Date | null;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  productCount: number;
}

export async function listSafeAccounts(): Promise<SafeSourceAccount[]> {
  const accounts = await prisma.sourceAccount.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { sourceProducts: true } } },
  });

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    provider: a.provider,
    baseUrl: a.baseUrl,
    sessionStatus: a.sessionStatus as SessionStatus,
    isEnabled: a.isEnabled,
    hasUsername: Boolean(a.encryptedUsername),
    hasPassword: Boolean(a.encryptedPassword),
    hasCookie: Boolean(a.encryptedCookie),
    hasToken: Boolean(a.encryptedMerchantToken),
    lastAuthAt: a.lastAuthAt,
    lastVerifiedAt: a.lastVerifiedAt,
    lastError: a.lastError,
    productCount: a._count.sourceProducts,
  }));
}

export async function getSafeAccount(
  id: string,
): Promise<SafeSourceAccount | null> {
  const all = await listSafeAccounts();
  return all.find((a) => a.id === id) ?? null;
}
