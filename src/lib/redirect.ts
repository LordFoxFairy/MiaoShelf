/**
 * 跳转目标校验（spec §15.3、§22）。
 *
 * 两个不同的攻击面，都要挡：
 *  1. 开放重定向 —— /go 只接受内部 slug，目标 URL 从数据库读，绝不从 query 取。
 *     这个由路由层保证；本文件负责第二道。
 *  2. SSRF —— 管理员填的 targetUrlOverride 会被 Worker 端请求，
 *     必须挡住 localhost / 内网段 / file: / javascript: 之类。
 */

export type UrlRejectionReason =
  | "INVALID_URL"
  | "BAD_PROTOCOL"
  | "PRIVATE_HOST"
  | "HOST_NOT_ALLOWED";

export type UrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejectionReason; detail: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * 内网/回环地址。这些即便出现在允许域名列表里也一律拒绝，
 * 因为攻击者可能控制 DNS 把允许的域名解析到内网。
 */
const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
]);

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (PRIVATE_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".internal")) return true;

  // IPv4 私有段与保留段
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1, 5).map((part) => Number(part));
    if (octets.some((o) => Number.isNaN(o) || o > 255)) return true;
    const [a = 0, b = 0] = octets;

    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 回环
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 链路本地 / 云元数据
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a >= 224) return true; // 组播与保留
    return false;
  }

  // IPv6 回环/唯一本地/链路本地
  if (host === "::") return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("fe80:")) return true;

  return false;
}

/** 域名是否命中允许列表。允许精确匹配和子域。 */
export function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((raw) => {
    const allowed = raw.trim().toLowerCase();
    if (!allowed) return false;
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

/**
 * @param allowedHosts 来自 LDXP_ALLOWED_REDIRECT_HOSTS。
 *                     传空数组表示"未配置"，此时只做协议和内网检查——
 *                     配置缺失不应该让整站跳转全挂，但会记录告警。
 */
export function validateRedirectUrl(
  raw: string,
  allowedHosts: string[],
): UrlValidation {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "INVALID_URL", detail: raw };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: "BAD_PROTOCOL", detail: url.protocol };
  }

  if (isPrivateHostname(url.hostname)) {
    return { ok: false, reason: "PRIVATE_HOST", detail: url.hostname };
  }

  if (allowedHosts.length > 0 && !isHostAllowed(url.hostname, allowedHosts)) {
    return { ok: false, reason: "HOST_NOT_ALLOWED", detail: url.hostname };
  }

  return { ok: true, url };
}

/**
 * 目标链接优先级（spec §9.3）：
 *   管理员 override → 来源自带 link → getLink().link → getLink().short_link
 */
export function pickTargetUrl(candidates: {
  targetUrlOverride?: string | null;
  sourceUrl?: string | null;
  resolvedLink?: string | null;
  resolvedShortLink?: string | null;
}): string | null {
  return (
    candidates.targetUrlOverride?.trim() ||
    candidates.sourceUrl?.trim() ||
    candidates.resolvedLink?.trim() ||
    candidates.resolvedShortLink?.trim() ||
    null
  );
}
