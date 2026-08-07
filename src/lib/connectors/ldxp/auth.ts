import { requestJson } from "@/lib/connectors/http";
import { ConnectorError } from "@/lib/connectors/types";
import { safeErrorDetail } from "@/lib/connectors/normalize";

/**
 * 小铺账号密码登录。
 *
 * 纯 HTTP，不需要浏览器 —— 这条链路来自对 maile456/source-browser 源码的核对。
 * 所以本项目在 Cloudflare Workers 这类无浏览器环境也能登录。
 *
 * 流程：
 *   1. system/config     预热，拿到初始 Cookie
 *   2. user/checkSafeMode 提前判断账号是否需要安全验证（验证码）
 *   3. user/login        拿 merchant_token
 *   4. user/userinfo     确认登录成功并取账号信息
 *
 * 关于 safe_mode：非 0 表示该账号被要求人工验证。此时立刻停止，
 * 不尝试识别或绕过验证码 —— 改由管理员手动导入会话。
 */

/** 登录相关接口都在 pay 域下，和商品接口的 www 域不同。 */
export const LDXP_AUTH_BASE = "https://pay.ldxp.cn";

const AUTH_API = {
  systemConfig: "/merchantApi/system/config",
  checkSafeMode: "/merchantApi/user/checkSafeMode",
  login: "/merchantApi/user/login",
  userInfo: "/merchantApi/user/userinfo",
} as const;

export type LoginResult =
  | {
      status: "SUCCESS";
      merchantToken: string;
      cookie: string;
      nickname: string | null;
    }
  | {
      status: "NEEDS_VERIFICATION";
      message: string;
    }
  | {
      status: "FAILED";
      message: string;
    };

export interface LoginParams {
  baseUrl?: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface Envelope {
  code?: unknown;
  data?: unknown;
  msg?: unknown;
}

export async function loginWithPassword(
  params: LoginParams,
): Promise<LoginResult> {
  const base = (params.baseUrl ?? LDXP_AUTH_BASE).replace(/\/+$/, "");
  const { username, password, fetchImpl, timeoutMs = 20_000 } = params;

  // 登录过程中累积 Cookie，后续请求要带上。
  const jar = new CookieJar();

  const call = async (
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ envelope: Envelope; setCookie: string[] }> => {
    const result = await requestJsonWithCookies(`${base}${path}`, {
      body,
      cookie: jar.toHeader(),
      referer: `${base}/merchant/`,
      origin: base,
      fetchImpl,
      timeoutMs,
    });
    jar.absorb(result.setCookie);
    return result;
  };

  try {
    // 1. 预热：拿初始 Cookie。失败不致命，继续往下走。
    await call(AUTH_API.systemConfig, {}).catch(() => null);

    // 2. 安全模式检查：提前发现"这个账号需要验证码"，
    //    比登录失败后才知道要友好得多。
    const safe = await call(AUTH_API.checkSafeMode, { username, password });
    const safeData = safe.envelope.data as { safe_mode?: unknown } | undefined;
    const safeMode = Number(safeData?.safe_mode ?? 0);

    if (Number.isFinite(safeMode) && safeMode !== 0) {
      return {
        status: "NEEDS_VERIFICATION",
        message:
          "该账号已开启安全验证（需要验证码），无法自动登录。请在浏览器登录后手动导入 Cookie 与 Merchant-Token。",
      };
    }

    // 3. 正式登录
    const login = await call(AUTH_API.login, { username, password });
    if (Number(login.envelope.code) !== 1) {
      return {
        status: "FAILED",
        message: asMessage(login.envelope.msg, "登录失败，请检查账号密码"),
      };
    }

    const loginData = login.envelope.data as
      | { merchant_token?: unknown }
      | undefined;
    const merchantToken =
      typeof loginData?.merchant_token === "string"
        ? loginData.merchant_token
        : null;

    if (!merchantToken) {
      return {
        status: "FAILED",
        message: "登录响应中没有 merchant_token，接口可能已变更",
      };
    }

    // 4. 用拿到的 token 验证一次，确认会话真的可用。
    let nickname: string | null = null;
    try {
      const info = await requestJsonWithCookies(`${base}${AUTH_API.userInfo}`, {
        body: {},
        cookie: jar.toHeader(),
        token: merchantToken,
        referer: `${base}/merchant/`,
        origin: base,
        fetchImpl,
        timeoutMs,
      });
      const infoData = info.envelope.data as
        | { nickname?: unknown; username?: unknown }
        | undefined;
      nickname =
        (typeof infoData?.nickname === "string" ? infoData.nickname : null) ??
        (typeof infoData?.username === "string" ? infoData.username : null);
    } catch {
      // 拿不到昵称不影响登录结果。
    }

    // 平台同时认 Cookie 和 Merchant-Token，两个都存下来。
    jar.set("merchant-token", merchantToken);

    return {
      status: "SUCCESS",
      merchantToken,
      cookie: jar.toHeader(),
      nickname,
    };
  } catch (error) {
    if (error instanceof ConnectorError && error.kind === "FORBIDDEN") {
      return {
        status: "NEEDS_VERIFICATION",
        message: "登录被风控拦截，请在浏览器登录后手动导入会话。",
      };
    }
    return {
      status: "FAILED",
      message: safeErrorDetail(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

function asMessage(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/** 极简 Cookie 罐：登录过程要在几次请求之间传递 Cookie。 */
class CookieJar {
  private readonly jar = new Map<string, string>();

  absorb(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const pair = header.split(";")[0];
      if (!pair) continue;
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      this.jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  set(name: string, value: string): void {
    this.jar.set(name, value);
  }

  toHeader(): string {
    return Array.from(this.jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

/**
 * 登录专用的请求：需要读 set-cookie，普通 requestJson 拿不到。
 */
async function requestJsonWithCookies(
  url: string,
  options: {
    body: Record<string, unknown>;
    cookie?: string;
    token?: string;
    referer?: string;
    origin?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{ envelope: Envelope; setCookie: string[] }> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers["Merchant-Token"] = options.token;
  if (options.referer) headers.Referer = options.referer;
  if (options.origin) headers.Origin = options.origin;

  const fetchImpl = options.fetchImpl ?? fetch;
  const setCookie: string[] = [];

  // 包一层 fetch 以便捕获 set-cookie，其余错误分类仍复用 requestJson。
  const capturingFetch: typeof fetch = async (input, init) => {
    const response = await fetchImpl(input, init);
    const raw = response.headers.getSetCookie?.() ?? [];
    setCookie.push(...raw);
    if (raw.length === 0) {
      const single = response.headers.get("set-cookie");
      if (single) setCookie.push(single);
    }
    return response;
  };

  const result = await requestJson(url, {
    method: "POST",
    headers,
    body: options.body,
    timeoutMs: options.timeoutMs,
    fetchImpl: capturingFetch,
  });

  return { envelope: (result.json ?? {}) as Envelope, setCookie };
}
