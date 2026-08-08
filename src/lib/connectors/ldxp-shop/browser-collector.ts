import { chromium, type BrowserContext, type Page } from "playwright";
import { ConnectorError } from "@/lib/connectors/types";
import { safeErrorDetail, looksLikeHtml } from "@/lib/connectors/normalize";

/**
 * 公开店铺的「真浏览器兜底」采集。
 *
 * 背景：轻量 HTTP 直接打 /shopApi/Shop/* 拿 JSON，是首选，快又轻。
 * 但当出口 IP 被货源平台的 WAF 标记时，直连会收到 JS 挑战页而不是 JSON
 * （典型特征 window._waf_is_mobile）。
 *
 * 这里的做法，和纯 HTTP 层「遇挑战就停」不同——**不破解挑战**，而是：
 *   1. 用一个真实的持久化 Chrome 打开店铺页面；
 *   2. 让浏览器自己把 WAF 的 JS 挑战正常跑过去（真浏览器本就能通过，
 *      这不是伪造，就是一次正常的浏览器访问）；
 *   3. 拿到 WAF 放行后的会话 cookie，在**同一个页面上下文里**用 fetch
 *      调那个公开 JSON 接口——请求自动带上放行 cookie，返回正常 JSON。
 *
 * 与 ldxp/login.ts 里 probeSession 是同一套模式（page.evaluate + fetch）。
 * 只读公开接口，不涉及任何登录/凭据。
 *
 * 代价：起浏览器比纯 HTTP 慢几十倍、依赖本机 Chrome。所以它是**兜底**，
 * 只在纯 HTTP 撞上 WAF 时才用，不作为默认路径。
 */

export interface BrowserCollectOptions {
  /** 店铺 API 根地址，如 https://pay.ldxp.cn */
  apiBase: string;
  /** 店铺 token，如 miaoli */
  token: string;
  /** 持久化 Profile 目录，复用会话可避免每次都重新过挑战。 */
  profilePath: string;
  headless?: boolean;
  timeoutMs?: number;
  /**
   * 手动闯关模式：自动没过 WAF 挑战时，保持有头浏览器打开，
   * 等你手动把滑块/验证滑过去。程序会轮询接口，检测到放行就继续。
   * 需要 headless=false 才有意义。默认关。
   */
  manual?: boolean;
  /**
   * 手动闯关最多等多久（毫秒）。<=0 表示一直等、不催你——默认就是它，
   * 因为谁也说不准你啥时候有空滑。想设上限就传个正数。
   */
  manualTimeoutMs?: number;
  /**
   * 浏览器出口代理，形如 http://用户:密码@地址:端口。
   * 不传则读 SOURCE_HTTP_PROXY —— 和纯 HTTP 那条路（proxy-fetch）用同一个出口，
   * 免得「HTTP 走代理、浏览器走本机」两个 IP 打架，cookie 拿回来在服务器上不认。
   */
  proxy?: string;
}

/** 把代理 URL 拆成 Playwright launch 要的 {server,username,password}。 */
function parseProxy(raw: string | undefined):
  | { server: string; username?: string; password?: string }
  | undefined {
  const value = (raw ?? process.env.SOURCE_HTTP_PROXY ?? "").trim();
  if (!value) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    // Chrome 不认 socks5h，统一成 socks5。
    const protocol = url.protocol === "socks5h:" ? "socks5:" : url.protocol;
    return {
      server: `${protocol}//${url.host}`,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
    };
  } catch {
    console.warn("[浏览器采集] 代理地址解析失败，忽略代理：", value.slice(0, 30));
    return undefined;
  }
}

/**
 * 启动参数与反检测掩码，两个入口共用。
 *
 * 参考 FlowPilot（engine/config/uc.py + roxy_registration._apply_browser_automation_mask）：
 *   - `--disable-blink-features=AutomationControlled` 去掉最显眼的自动化标记；
 *   - 注入脚本抹平 navigator.webdriver / chrome.runtime / permissions 三处痕迹。
 *
 * 说明：这只降低「一眼看出是自动化」的程度，**不足以过阿里云 ESA 的滑动验证**
 * （实测仍判定失败）。留着是因为对手动闯关也有好处——痕迹越少，人工滑过后
 * 会话被二次质询的概率越低。
 */
const LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-dev-shm-usage",
];

const STEALTH_SCRIPT = `
Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) window.chrome.runtime = {};
const _q = window.navigator.permissions && window.navigator.permissions.query;
if (_q) {
  window.navigator.permissions.query = (p) =>
    p && p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : _q(p);
}
`;

/**
 * 强力关闭浏览器，保证不留僵尸/孤儿进程。
 *
 * 光 `context.close()` 不够：Chrome 卡死时 close() 会一直挂着不返回，
 * finally 里 await 它就等于永远关不掉，进程留在机器上（跑多了堆一地）。
 * 参考 FlowPilot force_quit_driver 的思路——先正常关，超时就杀底层进程。
 */
/**
 * 还活着的 context，用于进程被强杀时兜底清理。
 *
 * finally 只在正常抛错/返回时跑；Ctrl-C、SIGTERM（Docker stop）会直接结束进程，
 * finally 根本不执行，浏览器就变成孤儿进程活下来了。所以另外挂信号处理。
 */
const liveContexts = new Set<BrowserContext>();
let signalHookInstalled = false;

function installSignalHook(): void {
  if (signalHookInstalled) return;
  signalHookInstalled = true;
  const cleanup = () => {
    for (const ctx of liveContexts) {
      const pid = (
        ctx.browser() as unknown as { process?: () => { pid?: number } | null }
      )?.process?.()?.pid;
      // 进程要退了，来不及 await——直接杀，这是唯一可靠的做法。
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* 已经没了 */
        }
      }
    }
    liveContexts.clear();
  };
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  // 未捕获异常同样会跳过 finally。
  process.once("uncaughtException", (err) => {
    cleanup();
    throw err;
  });
}

async function forceClose(context: BrowserContext | null): Promise<void> {
  if (!context) return;
  liveContexts.delete(context);

  // 先记下底层浏览器进程，close() 之后就拿不到了。
  const child = (
    context.browser() as unknown as { process?: () => { pid?: number } | null }
  )?.process?.();
  const pid = child?.pid;

  // 正常关，但最多等 10 秒——挂住就不等了，走下面的 kill。
  await Promise.race([
    context.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);

  // 兜底：close() 没能收干净就直接杀。杀不掉（已经退了）忽略即可。
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
      console.warn(`[浏览器采集] close() 超时，已强杀浏览器进程 pid=${pid}`);
    } catch {
      /* 进程已经没了，正常路径 */
    }
  }
}

/** 公用的浏览器启动配置。 */
function launchOptions(headless: boolean, proxy: string | undefined) {
  const parsed = parseProxy(proxy);
  return {
    headless,
    args: LAUNCH_ARGS,
    // 走本地中转代理（mitmproxy 之类）时是自签证书，浏览器不认会直接
    // ERR_CERT_AUTHORITY_INVALID 打不开页面。只对本地回环放宽，
    // 公网代理仍然严格校验证书。
    ignoreHTTPSErrors: /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(
      parsed?.server ?? "",
    ),
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    proxy: parsed,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
}

/**
 * 本机用真浏览器过一次 WAF，导出放行 cookie（acw_tc/cdn_sec_tc/PHPSESSID）。
 *
 * 拿到的 cookie 字符串存进服务器凭据后，服务器纯 HTTP 带上它即可放行，
 * 无需在服务器上跑浏览器或滑 iframe——滑块（若有）只在你本机发生。
 *
 * 挑战自动过不了且开了手动模式时，会保持有头浏览器等你手动滑过。
 */
export async function grabWafCookie(options: BrowserCollectOptions): Promise<{
  cookie: string;
  shopName: string | null;
}> {
  const {
    apiBase,
    token,
    profilePath,
    headless = false,
    timeoutMs = 45_000,
    manual = true,
    manualTimeoutMs = 0,
  } = options;

  const origin = apiBase.replace(/\/+$/, "");
  let context: BrowserContext | null = null;

  try {
    installSignalHook();
    context = await chromium.launchPersistentContext(
      profilePath,
      launchOptions(headless, options.proxy),
    );
    liveContexts.add(context); // 登记，进程被强杀时好清理
    await context.addInitScript(STEALTH_SCRIPT);
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(timeoutMs);

    await page.goto(`${origin}/shop/${token}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .waitForLoadState("networkidle", { timeout: timeoutMs })
      .catch(() => {});

    const probe = () =>
      page.evaluate(
        async ({ base, tk }) => {
          const r = await fetch(`${base}/shopApi/Shop/info`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/plain, */*",
            },
            body: JSON.stringify({ token: tk }),
          });
          return { status: r.status, text: await r.text() };
        },
        { base: origin, tk: token },
      );

    let res = await probe();

    if (looksLikeHtml(res.text) && manual && !headless) {
      const waitForever = manualTimeoutMs <= 0;
      console.log(
        "\n[取 cookie] 撞上 WAF 挑战，已弹出浏览器。请在窗口里完成验证/滑块——" +
          (waitForever ? "程序会一直等你。\n" : `最多等 ${Math.round(manualTimeoutMs / 1000)} 秒。\n`),
      );
      await page.bringToFront().catch(() => {});
      const deadline = Date.now() + manualTimeoutMs;
      // 浏览器崩掉时 probe() 会一直抛错、res 永不更新，waitForever 下就成了
      // 停不下来的死循环。连错这么多次就认定浏览器没了，跳出去报错。
      let consecutiveErrors = 0;
      while ((waitForever || Date.now() < deadline) && looksLikeHtml(res.text)) {
        if (page.isClosed()) break;
        await page.waitForTimeout(2_000);
        try {
          res = await probe();
          consecutiveErrors = 0;
        } catch {
          if (++consecutiveErrors >= 10) {
            throw new ConnectorError(
              "NETWORK",
              "等待手动验证时浏览器失去响应（连续探测失败），已中止。请重跑。",
            );
          }
        }
      }
    }

    if (looksLikeHtml(res.text)) {
      throw new ConnectorError(
        "FORBIDDEN",
        "没能过 WAF 挑战（可能超时或窗口被关）。请重试并尽快完成验证。",
      );
    }

    // 过关了，导出 cookie
    const cookies = await context.cookies(origin);
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    if (!cookie) {
      throw new ConnectorError("UNKNOWN", "过关后没拿到任何 cookie，异常。");
    }

    let shopName: string | null = null;
    try {
      const json = JSON.parse(res.text) as { data?: { nickname?: string } };
      shopName = json.data?.nickname ?? null;
    } catch {
      /* 拿名字失败不影响 cookie */
    }

    return { cookie, shopName };
  } finally {
    await forceClose(context);
  }
}

/**
 * 用真浏览器调一个公开店铺接口，返回解析后的 JSON envelope。
 *
 * @param path 形如 "/shopApi/Shop/goodsList"
 * @param payload 请求体（token 会自动补上）
 */
export async function collectViaBrowser<T = unknown>(
  path: string,
  payload: Record<string, unknown>,
  options: BrowserCollectOptions,
): Promise<T> {
  const {
    apiBase,
    token,
    profilePath,
    headless = true,
    timeoutMs = 45_000,
    manual = false,
    manualTimeoutMs = 0, // 默认一直等
  } = options;

  const origin = apiBase.replace(/\/+$/, "");
  let context: BrowserContext | null = null;

  try {
    installSignalHook();
    context = await chromium.launchPersistentContext(
      profilePath,
      launchOptions(headless, options.proxy),
    );
    liveContexts.add(context); // 登记，进程被强杀时好清理
    await context.addInitScript(STEALTH_SCRIPT);

    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(timeoutMs);

    // 1. 打开店铺页面，让浏览器把 WAF 的 JS 挑战正常跑过去。
    //    挑战页会自动刷新/跳转到真实页面，networkidle 等它稳定。
    await page.goto(`${origin}/shop/${token}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .waitForLoadState("networkidle", { timeout: timeoutMs })
      .catch(() => {
        /* 拿不到 networkidle 不致命，下面调接口时会真正验证是否放行 */
      });

    // 2. 在页面上下文里调公开接口——自动带上 WAF 放行后的 cookie。
    //    一次就成最好；若仍是挑战页且开了手动模式，则等你手动滑过后重试。
    const callApi = () =>
      page.evaluate(
        async ({ base, apiPath, body }) => {
          const response = await fetch(`${base}${apiPath}`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/plain, */*",
            },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          return { status: response.status, text };
        },
        { base: origin, apiPath: path, body: { token, ...payload } },
      );

    let result = await callApi();

    // 3. 仍是 HTML = 挑战没过。
    if (looksLikeHtml(result.text)) {
      if (manual && !headless) {
        // 手动闯关：把店铺页面摆到你面前，等你把滑块/验证过掉。
        // 每 2 秒重试一次接口，检测到放行（不再是 HTML）就继续。
        // manualTimeoutMs <= 0 表示一直等，不催你。
        const waitForever = manualTimeoutMs <= 0;
        console.log(
          "\n[浏览器采集] 撞上 WAF 挑战，已弹出浏览器。请在窗口里手动完成验证/滑块——" +
            (waitForever
              ? "程序会一直等你，慢慢来，过了自动继续。\n"
              : `程序会自动检测并继续（最多等 ${Math.round(manualTimeoutMs / 1000)} 秒）。\n`),
        );
        // 确保挑战页在最前面，方便你操作
        await page.bringToFront().catch(() => {});
        const deadline = Date.now() + manualTimeoutMs;
        while (
          (waitForever || Date.now() < deadline) &&
          looksLikeHtml(result.text)
        ) {
          // 窗口被关掉就别再空转了，直接跳出去报错。
          if (page.isClosed()) {
            throw new ConnectorError(
              "FORBIDDEN",
              "验证还没过，浏览器窗口就被关闭了。请重开并完成滑块。",
            );
          }
          await page.waitForTimeout(2_000);
          result = await callApi().catch(() => result);
        }
      }

      if (looksLikeHtml(result.text)) {
        throw new ConnectorError(
          "FORBIDDEN",
          manual
            ? "等待手动验证超时，或验证未通过。请重试，并在浏览器弹窗里尽快完成滑块。"
            : "真浏览器访问仍被 WAF 拦截（返回挑战页）。可开启手动模式在弹窗里滑过，" +
              "或更换出口 IP（配置 SOURCE_HTTP_PROXY）后重试。",
          {
            statusCode: result.status,
            detail: safeErrorDetail(result.text, 200),
          },
        );
      }
    }

    let json: unknown;
    try {
      json = JSON.parse(result.text);
    } catch (cause) {
      throw new ConnectorError("SCHEMA", "浏览器采集返回的不是合法 JSON", {
        statusCode: result.status,
        detail: safeErrorDetail(result.text, 200),
        cause,
      });
    }

    const envelope = json as { code?: unknown; data?: unknown; msg?: unknown };
    if (Number(envelope.code) !== 1) {
      const message =
        typeof envelope.msg === "string" && envelope.msg
          ? envelope.msg
          : `接口返回 code=${envelope.code}`;
      throw new ConnectorError("UNKNOWN", message, {
        detail: safeErrorDetail(message),
      });
    }

    return envelope.data as T;
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError(
      "NETWORK",
      `浏览器采集失败：${safeErrorDetail(
        error instanceof Error ? error.message : String(error),
      )}`,
      { cause: error },
    );
  } finally {
    await forceClose(context);
  }
}
