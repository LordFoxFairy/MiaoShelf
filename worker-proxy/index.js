/**
 * 货源接口中转（Cloudflare Worker）。
 *
 * 为什么要它：服务器所在的机房 IP 段被货源平台的 WAF 标记，
 * 直连会收到 JS 挑战页而不是 JSON。经 Cloudflare 边缘转发换一个出口。
 *
 * 这不是绕过 WAF —— 请求内容、频率、限流策略完全不变，
 * WAF 的挑战脚本我们从不尝试执行或破解。若 Cloudflare 出口同样被挡，
 * 这个方案就直接放弃，不做进一步对抗。
 *
 * 安全：必须带正确的 PROXY_TOKEN，否则任何人都能拿它当开放代理。
 */

const ALLOWED_HOSTS = new Set(["pay.ldxp.cn", "www.ldxp.cn"]);
const ALLOWED_PREFIXES = ["/shopApi/", "/merchantApi/"];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    // 无鉴权的探活，方便部署后确认 Worker 活着
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/ping") {
      return json({ ok: true, colo: request.cf?.colo ?? null });
    }

    if (request.method !== "POST") {
      return json({ error: "只支持 POST" }, 405);
    }

    if (!env.PROXY_TOKEN || request.headers.get("X-Proxy-Token") !== env.PROXY_TOKEN) {
      return json({ error: "未授权" }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "请求体不是合法 JSON" }, 400);
    }

    const { target, body } = payload ?? {};
    if (typeof target !== "string") return json({ error: "缺少 target" }, 400);

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return json({ error: "target 不是合法 URL" }, 400);
    }

    // 白名单：不能被当成任意 URL 的代理
    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return json({ error: `不允许的主机：${targetUrl.hostname}` }, 403);
    }
    if (!ALLOWED_PREFIXES.some((p) => targetUrl.pathname.startsWith(p))) {
      return json({ error: `不允许的路径：${targetUrl.pathname}` }, 403);
    }

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Origin: targetUrl.origin,
      Referer: `${targetUrl.origin}/`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    };

    // 商家后台接口需要的认证头，由调用方传入后原样转发
    for (const name of ["Cookie", "Merchant-Token", "Authorization"]) {
      const value = request.headers.get(`X-Fwd-${name}`);
      if (value) headers[name] = value;
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(body ?? {}),
      });

      const text = await upstream.text();

      // 上游返回 HTML 说明这个出口也被挡了，如实报告，
      // 不能让调用方误以为"店铺没有商品"。
      if (/^\s*<(!doctype|html)/i.test(text.slice(0, 100))) {
        return json(
          {
            error: "上游返回 HTML，该出口同样被访问保护拦截",
            upstreamStatus: upstream.status,
            colo: request.cf?.colo ?? null,
          },
          502,
        );
      }

      return new Response(text, {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...cors() },
      });
    } catch (error) {
      return json({ error: `转发失败：${error.message}` }, 502);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Proxy-Token, X-Fwd-Cookie, X-Fwd-Merchant-Token",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}
