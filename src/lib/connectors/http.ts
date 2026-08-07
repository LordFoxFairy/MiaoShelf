import { ConnectorError } from "@/lib/connectors/types";
import { looksLikeHtml, safeErrorDetail } from "@/lib/connectors/normalize";

/**
 * 各平台 Adapter 共用的 HTTP 层。
 *
 * 这里最重要的职责是**错误分类**：把网络层和 HTTP 层的各种失败
 * 归到 FailureKind 上。上层据此决定"重试 / 等人工登录 / 保留旧数据"，
 * 但无论哪一类，都绝不会推导出"缺货"（spec §7.5、§16.3）。
 */

export interface HttpRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** 请求前的随机延迟，避免定时任务同时打满外部接口。 */
  jitterMs?: number;
}

export interface HttpResult {
  status: number;
  /** 已解析的 JSON；响应不是 JSON 时为 undefined。 */
  json: unknown;
  /** 原始文本，仅在需要排查时使用（已截断）。 */
  text: string;
}

export async function requestJson(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResult> {
  const {
    method = "POST",
    headers = {},
    body,
    timeoutMs = 15000,
    fetchImpl = fetch,
    jitterMs = 0,
  } = options;

  if (jitterMs > 0) {
    await sleep(Math.floor(Math.random() * jitterMs));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json, text/plain, */*",
        ...(body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (cause) {
    clearTimeout(timer);

    // AbortError 说明是我们主动超时的。
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new ConnectorError("TIMEOUT", `请求超时（${timeoutMs}ms）`, {
        cause,
      });
    }
    throw new ConnectorError("NETWORK", "网络请求失败", { cause });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => "");

  // 先按 HTTP 状态分类 —— 这几类都明确表示"我们没问到"，不是"没货"。
  if (response.status === 401) {
    throw new ConnectorError("AUTH", "登录失效（401）", {
      statusCode: 401,
      detail: safeErrorDetail(text, 200),
    });
  }

  if (response.status === 403) {
    // 403 且返回 HTML，基本可以确定是 WAF 或验证码页。
    const kind = looksLikeHtml(text) ? "FORBIDDEN" : "FORBIDDEN";
    throw new ConnectorError(kind, "访问被拒绝（403），可能触发风控或需要验证", {
      statusCode: 403,
      detail: safeErrorDetail(text, 200),
    });
  }

  if (response.status === 429) {
    throw new ConnectorError("RATE_LIMIT", "请求过于频繁（429）", {
      statusCode: 429,
      detail: safeErrorDetail(text, 200),
    });
  }

  if (response.status >= 500) {
    throw new ConnectorError("SERVER", `外部服务错误（${response.status}）`, {
      statusCode: response.status,
      detail: safeErrorDetail(text, 200),
    });
  }

  // 拿到 200 但内容是 HTML —— 典型的验证码/WAF 挑战页伪装成成功响应。
  if (looksLikeHtml(text)) {
    // WAF 挑战页有明显特征，单独识别出来给出可操作的提示，
    // 否则用户只会看到"需要验证"却不知道该怎么办。
    const isWafChallenge = /_waf_|waf_is_mobile|challenge|安全检查/i.test(
      text.slice(0, 2000),
    );

    throw new ConnectorError(
      "FORBIDDEN",
      isWafChallenge
        ? "货源平台的访问保护拦截了本次请求（返回了 JS 挑战页）。" +
          "通常是服务器 IP 被标记所致，可配置 SOURCE_HTTP_PROXY 换一个出口 IP。"
        : "响应为 HTML 页面，可能需要人工验证或重新登录",
      { statusCode: response.status, detail: safeErrorDetail(text, 200) },
    );
  }

  if (response.status >= 400) {
    throw new ConnectorError("UNKNOWN", `请求失败（${response.status}）`, {
      statusCode: response.status,
      detail: safeErrorDetail(text, 200),
    });
  }

  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (cause) {
      throw new ConnectorError("SCHEMA", "响应不是合法 JSON", {
        statusCode: response.status,
        detail: safeErrorDetail(text, 200),
        cause,
      });
    }
  }

  return { status: response.status, json, text: text.slice(0, 4000) };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
