import { chromium, type BrowserContext } from "playwright";
import { safeErrorDetail } from "@/lib/connectors/normalize";

/**
 * 小铺模拟登录（spec §10.2）。
 *
 * 为什么必须用真实浏览器：小铺是前端应用，登录后 token 存在
 * localStorage["auth-token"] 里，同时还要带 Cookie。
 * 纯 HTTP 请求拿不到这些，必须跑一个真浏览器。
 *
 * 用 persistent context 保存浏览器 Profile：下次登录时如果会话还在，
 * 可以直接复用，不用每次都输密码，也降低触发风控的概率。
 *
 * 底线：遇到验证码或人工验证一律停下来（NEEDS_VERIFICATION），
 * 绝不尝试识别、绕过或无限重试。
 */

export type LoginOutcome =
  | {
      status: "SUCCESS";
      cookie: string;
      merchantToken: string | null;
    }
  | {
      status: "NEEDS_VERIFICATION";
      message: string;
      /** 截图（base64），让管理员看清楚卡在哪一步。 */
      screenshot: string | null;
    }
  | {
      status: "FAILED";
      message: string;
    };

export interface LoginOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** 浏览器 Profile 目录，保存会话以便复用。 */
  profilePath: string;
  headless?: boolean;
  timeoutMs?: number;
}

/** 登录页常见的表单选择器，逐个试——站点改版时不至于立刻全挂。 */
const USERNAME_SELECTORS = [
  'input[name="username"]',
  'input[name="account"]',
  'input[name="mobile"]',
  'input[name="phone"]',
  'input[type="text"]',
];

const PASSWORD_SELECTORS = [
  'input[name="password"]',
  'input[type="password"]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'button:has-text("登录")',
  'button:has-text("登 录")',
  '.login-btn',
];

/** 页面上出现这些内容就说明需要人工介入。 */
const VERIFICATION_HINTS = [
  "验证码",
  "滑动",
  "拖动",
  "人机验证",
  "安全验证",
  "captcha",
  "slider",
];

export async function loginToLdxp(
  options: LoginOptions,
): Promise<LoginOutcome> {
  const {
    baseUrl,
    username,
    password,
    profilePath,
    headless = true,
    timeoutMs = 45_000,
  } = options;

  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      headless,
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      // 用常见 UA，但不做任何伪装/指纹对抗——只是避免被当成明显异常的客户端。
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(timeoutMs);

    const origin = baseUrl.replace(/\/+$/, "");

    // 先看看已有会话还能不能用——能用就不必再登录一次。
    const existing = await readSession(context, page, origin);
    if (existing.merchantToken || existing.cookie.includes("=")) {
      const stillValid = await probeSession(page, origin);
      if (stillValid) {
        return {
          status: "SUCCESS",
          cookie: existing.cookie,
          merchantToken: existing.merchantToken,
        };
      }
    }

    await page.goto(`${origin}/merchant/login`, {
      waitUntil: "domcontentloaded",
    });

    // 有可能已经是登录态被直接重定向走了。
    if (!/login/i.test(page.url())) {
      const session = await readSession(context, page, origin);
      if (session.merchantToken) {
        return {
          status: "SUCCESS",
          cookie: session.cookie,
          merchantToken: session.merchantToken,
        };
      }
    }

    const usernameInput = await findFirst(page, USERNAME_SELECTORS);
    const passwordInput = await findFirst(page, PASSWORD_SELECTORS);

    if (!usernameInput || !passwordInput) {
      return {
        status: "FAILED",
        message:
          "找不到登录表单，站点可能已改版。请改用导入 Cookie 的方式。",
      };
    }

    await usernameInput.fill(username);
    await passwordInput.fill(password);

    const submit = await findFirst(page, SUBMIT_SELECTORS);
    if (!submit) {
      return { status: "FAILED", message: "找不到登录按钮" };
    }

    await submit.click();

    // 等跳转或等 token 出现，谁先来算谁。
    await Promise.race([
      page.waitForURL((url) => !/login/i.test(url.toString()), {
        timeout: timeoutMs,
      }),
      page.waitForFunction(
        () => Boolean(window.localStorage.getItem("auth-token")),
        undefined,
        { timeout: timeoutMs },
      ),
    ]).catch(() => {
      /* 超时不直接失败，下面统一判断状态 */
    });

    // 验证码/风控检测：出现就停，不尝试绕过。
    const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
    const needsVerification = VERIFICATION_HINTS.some((hint) =>
      bodyText.toLowerCase().includes(hint.toLowerCase()),
    );

    const session = await readSession(context, page, origin);

    if (!session.merchantToken && needsVerification) {
      const screenshot = await page
        .screenshot({ type: "png" })
        .then((buffer) => buffer.toString("base64"))
        .catch(() => null);

      return {
        status: "NEEDS_VERIFICATION",
        message:
          "登录需要人工验证（验证码或安全验证）。请在浏览器中手动登录后导入会话。",
        screenshot,
      };
    }

    if (!session.merchantToken && !session.cookie) {
      return {
        status: "FAILED",
        message: "登录未成功，请检查账号密码是否正确。",
      };
    }

    return {
      status: "SUCCESS",
      cookie: session.cookie,
      merchantToken: session.merchantToken,
    };
  } catch (error) {
    return {
      status: "FAILED",
      message: safeErrorDetail(
        error instanceof Error ? error.message : String(error),
      ),
    };
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * 读取会话。
 * auth-token 可能是纯字符串，也可能是 {value} 或 {token} 的 JSON——
 * 两种都要处理。
 */
async function readSession(
  context: BrowserContext,
  page: import("playwright").Page,
  origin: string,
): Promise<{ cookie: string; merchantToken: string | null }> {
  const cookies = await context.cookies(origin).catch(() => []);
  const cookie = cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const merchantToken = await page
    .evaluate(() => {
      const raw = window.localStorage.getItem("auth-token");
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed?.value ?? parsed?.token ?? null;
      } catch {
        return raw;
      }
    })
    .catch(() => null);

  return { cookie, merchantToken };
}

/** 用一个只读接口确认会话是否还有效。 */
async function probeSession(
  page: import("playwright").Page,
  origin: string,
): Promise<boolean> {
  try {
    const ok = await page.evaluate(async (base) => {
      const raw = window.localStorage.getItem("auth-token");
      let token = "";
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          token = parsed?.value ?? parsed?.token ?? "";
        } catch {
          token = raw;
        }
      }

      const response = await fetch(
        `${base}/merchantApi/GoodsCategory/listAll`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
            ...(token ? { "Merchant-Token": token } : {}),
          },
          body: JSON.stringify({ goods_type: "card" }),
        },
      );
      if (!response.ok) return false;
      const json = await response.json();
      return Number(json?.code) === 1;
    }, origin);

    return Boolean(ok);
  } catch {
    return false;
  }
}

async function findFirst(
  page: import("playwright").Page,
  selectors: string[],
) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().then((c) => c > 0).catch(() => false)) {
      if (await locator.isVisible().catch(() => false)) return locator;
    }
  }
  return null;
}
