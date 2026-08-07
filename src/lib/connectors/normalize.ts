import Decimal from "decimal.js";
import { Availability, SourceStatus } from "@/lib/enums";

/**
 * 各平台 Adapter 共用的字段归一化工具。
 *
 * 外部接口的字段类型极不稳定：价格一会儿是 "12.30" 一会儿是 12.3，
 * 库存可能是 null / "0" / 0 / 缺字段。这里统一消化掉，
 * 让 Adapter 只关心"哪个字段对应哪个语义"。
 */

/** 宽松解析金额。解析不出来返回 null，绝不返回 0 —— 0 是个有意义的价格。 */
export function parsePrice(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Decimal) return value;

  if (typeof value === "number") {
    return Number.isFinite(value) ? new Decimal(value) : null;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "").trim();
    if (!cleaned) return null;
    try {
      const d = new Decimal(cleaned);
      return d.isFinite() ? d : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 宽松解析库存。
 *
 * 返回 undefined 表示"这个字段没给"，返回 null 表示"平台明确说不限量"。
 * 两者语义不同，上层处理方式也不同，不能合并。
 */
export function parseStock(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined;
  }

  return undefined;
}

/** 从若干候选字段里挑第一个非空字符串。 */
export function pickString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/**
 * 平台状态码 → SourceStatus。
 * 认不出来一律 UNKNOWN，绝不猜成 INACTIVE —— 猜错就是把在售商品下架。
 */
export function mapSourceStatus(
  value: unknown,
  activeValues: ReadonlyArray<string | number>,
  inactiveValues: ReadonlyArray<string | number> = [],
): SourceStatus {
  if (value === null || value === undefined) return SourceStatus.UNKNOWN;

  const normalized = typeof value === "number" ? value : String(value).trim();

  if (activeValues.some((v) => String(v) === String(normalized))) {
    return SourceStatus.ACTIVE;
  }
  if (inactiveValues.some((v) => String(v) === String(normalized))) {
    return SourceStatus.INACTIVE;
  }
  return SourceStatus.UNKNOWN;
}

/** 由库存数推导 Availability。仅用于平台没直接给状态时。 */
export function availabilityFromStock(
  stockCount: number | null | undefined,
  lowStockThreshold: number,
): Availability | null {
  if (stockCount === undefined) return null; // 没给字段 → 不下结论
  if (stockCount === null) return Availability.NOT_APPLICABLE;
  if (stockCount === 0) return Availability.OUT_OF_STOCK;
  return stockCount <= lowStockThreshold
    ? Availability.LOW_STOCK
    : Availability.IN_STOCK;
}

/** 判断响应体是不是 HTML（验证码页/WAF 拦截页的典型特征）。 */
export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 200).toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<head")
  );
}

/** 日志脱敏：任何可能含凭据的字符串过一遍再输出（spec §22）。 */
const SENSITIVE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/(cookie\s*[:=]\s*)([^\s;,"]+)/gi, "$1***"],
  [/(merchant-?token\s*[:=]\s*)([^\s;,"]+)/gi, "$1***"],
  [/(authorization\s*[:=]\s*)([^\s;,"]+)/gi, "$1***"],
  [/(auth-?token"?\s*[:=]\s*"?)([^\s;,"]+)/gi, "$1***"],
  [/(password"?\s*[:=]\s*"?)([^\s;,"]+)/gi, "$1***"],
];

export function redact(input: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    input,
  );
}

/** 截断并脱敏，用于存 lastError / SyncRun.error。 */
export function safeErrorDetail(input: string, maxLength = 500): string {
  return redact(input).slice(0, maxLength);
}
