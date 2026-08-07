import { ProxyAgent, fetch as undiciFetch } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";

/**
 * 可选的出口代理。
 *
 * 背景：某些机房 IP 段被货源平台的 WAF 标记，直连会收到 JS 挑战页
 * 而不是 JSON。配一个代理换个出口 IP 就能正常访问。
 *
 * 注意这**不是绕过 WAF** —— 请求内容、频率、限流策略完全不变，
 * 只是从另一个没被标记的 IP 发出去。WAF 的挑战我们从不尝试破解。
 *
 * 没配代理时返回全局 fetch，行为和以前一模一样。
 */

let cachedAgent: ProxyAgent | null = null;
let cachedProxyUrl: string | null = null;

function proxyUrl(): string | null {
  const url =
    process.env.SOURCE_HTTP_PROXY ??
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    null;
  return url?.trim() || null;
}

/**
 * 拿到该用的 fetch。
 * 配了代理就返回走代理的版本，没配就是原生 fetch。
 */
export function getSourceFetch(): typeof fetch {
  const url = proxyUrl();
  if (!url) return fetch;

  // 代理地址没变就复用同一个 agent，避免每次请求都新建连接池
  if (!cachedAgent || cachedProxyUrl !== url) {
    try {
      // socks5:// 和 socks5h:// 走 SocksProxyAgent，http(s):// 走 undici
      cachedAgent = url.startsWith("socks")
        ? (new SocksProxyAgent(url) as unknown as ProxyAgent)
        : new ProxyAgent(url);
      cachedProxyUrl = url;
    } catch {
      // 代理地址配错了就退回直连，总比整个同步挂掉好
      cachedAgent = null;
      cachedProxyUrl = null;
      return fetch;
    }
  }

  const agent = cachedAgent;

  // SOCKS 代理走 Node 的 http(s) 模块（undici 的 dispatcher 不认 SocksProxyAgent），
  // HTTP 代理走 undici。两者对调用方是一样的 fetch 接口。
  if (url.startsWith("socks")) {
    return socksFetch(agent as unknown as SocksProxyAgent);
  }

  return ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(String(input), {
      ...(init as Record<string, unknown>),
      dispatcher: agent as ProxyAgent,
    })) as unknown as typeof fetch;
}

/** 用 Node 的 https 模块 + SOCKS agent 实现一个最小可用的 fetch。 */
function socksFetch(agent: SocksProxyAgent): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { request } = await import("node:https");
    const target = new URL(String(input));

    return new Promise<Response>((resolve, reject) => {
      const req = request(
        {
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method: init?.method ?? "GET",
          headers: (init?.headers as Record<string, string>) ?? {},
          agent,
          timeout: 20_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode ?? 200,
                headers: res.headers as Record<string, string>,
              }),
            );
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("代理请求超时"));
      });

      if (init?.body) req.write(init.body);
      req.end();
    });
  }) as unknown as typeof fetch;
}

/** 当前是否在走代理，供后台状态显示。 */
export function isUsingProxy(): boolean {
  return proxyUrl() !== null;
}

/** 脱敏后的代理地址，日志和界面可以显示。 */
export function proxyLabel(): string | null {
  const url = proxyUrl();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // 代理地址里可能带账号密码，绝不能原样显示
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || "默认端口"}`;
  } catch {
    return "已配置";
  }
}
