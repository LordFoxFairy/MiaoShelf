import { createHash } from "node:crypto";

/**
 * 客户端来源信息的提取（spec §8.8、§15.4、§22）。
 *
 * 部署形态是 Cloudflare 反代 → Docker 里的 Next.js，所以 socket 上看到的
 * 永远是 Cloudflare 边缘节点的 IP。限流如果按那个地址算，等于把全站用户
 * 合并成几个 IP，一个人就能把所有人限死。必须读 CF-Connecting-IP。
 *
 * 但代理头是可以伪造的：只有在明确配置了 TRUSTED_PROXY_MODE=cloudflare
 * （即确认流量真的经过 Cloudflare）时才信任它，否则回落到应用层地址。
 */
export type TrustedProxyMode = "cloudflare" | "xff" | "none";

export interface ClientContext {
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  referrer: string | null;
}

export interface HeaderLike {
  get(name: string): string | null;
}

export function extractClientContext(
  headers: HeaderLike,
  mode: TrustedProxyMode,
  socketAddress?: string | null,
): ClientContext {
  return {
    ip: extractClientIp(headers, mode, socketAddress),
    country: mode === "cloudflare" ? headers.get("cf-ipcountry") : null,
    userAgent: headers.get("user-agent"),
    referrer: headers.get("referer"),
  };
}

export function extractClientIp(
  headers: HeaderLike,
  mode: TrustedProxyMode,
  socketAddress?: string | null,
): string | null {
  if (mode === "cloudflare") {
    const cf = headers.get("cf-connecting-ip");
    if (cf) return normalizeIp(cf);
  }

  if (mode === "cloudflare" || mode === "xff") {
    // XFF 是 "client, proxy1, proxy2"，最左边才是原始客户端。
    const xff = headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return normalizeIp(first);
    }
  }

  return socketAddress ? normalizeIp(socketAddress) : null;
}

function normalizeIp(raw: string): string {
  const trimmed = raw.trim();
  // IPv4-mapped IPv6，例如 ::ffff:1.2.3.4
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

/**
 * 加盐哈希，用于统计去重但不留明文 PII（spec §8.8、§22）。
 * 盐必须来自 CREDENTIAL_MASTER_KEY 派生，且不入库。
 */
export function hashWithSalt(value: string | null, salt: string): string | null {
  if (!value) return null;
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}
