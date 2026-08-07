import { Availability, SourceStatus, SyncStatus } from "@/lib/enums";

/**
 * 新鲜度判断（spec §13.2）。
 *
 * 三段式而不是简单的 TTL：
 *   now <= freshUntil                  → FRESH，可直接对用户声称"有货"
 *   freshUntil < now <= staleUntil     → STALE，先展示旧值 + 后台刷新
 *   now > staleUntil                   → EXPIRED，不再声称有货
 *
 * Redis TTL 只管内存回收，业务新鲜度一律以这两个时间戳为准。
 */
export type Freshness = "FRESH" | "STALE" | "EXPIRED";

export interface FreshnessInput {
  freshUntil: Date | null;
  staleUntil: Date | null;
}

export function computeFreshness(
  input: FreshnessInput,
  now: Date = new Date(),
): Freshness {
  const { freshUntil, staleUntil } = input;

  // 从没成功同步过 → 不能声称任何状态。
  if (!freshUntil || !staleUntil) return "EXPIRED";

  if (now.getTime() <= freshUntil.getTime()) return "FRESH";
  if (now.getTime() <= staleUntil.getTime()) return "STALE";
  return "EXPIRED";
}

export function isStaleOrWorse(
  input: FreshnessInput,
  now: Date = new Date(),
): boolean {
  return computeFreshness(input, now) !== "FRESH";
}

/**
 * 判断一次外部请求失败是否属于"不可信"错误。
 *
 * 这类错误绝不能推导出"缺货"——它们说明我们没问到，而不是问到了没有。
 * spec §7.5 明确列出的清单。
 */
export type FailureKind =
  | "AUTH" // 401 / 登录失效
  | "FORBIDDEN" // 403 / WAF / 验证码页
  | "RATE_LIMIT" // 429
  | "TIMEOUT"
  | "NETWORK"
  | "SERVER" // 5xx
  | "SCHEMA" // JSON 结构变化
  | "UNKNOWN";

/**
 * 所有 FailureKind 都不允许改写 availability —— 没有例外。
 * 写成常量而不是函数，是为了让"不存在例外分支"这件事在类型层面就成立。
 */
export const FAILURE_NEVER_MEANS_OUT_OF_STOCK = true as const;

/** 失败类型 → 同步状态。只有认证类问题才需要人工介入。 */
export function syncStatusForFailure(kind: FailureKind): SyncStatus {
  return kind === "AUTH" || kind === "FORBIDDEN"
    ? SyncStatus.AUTH_REQUIRED
    : SyncStatus.ERROR;
}

/**
 * 库存数 → Availability（spec §16.1 的连续确认规则）。
 *
 * 单次为 0 不足以判定缺货：外部接口偶发返回 0 很常见。
 * 必须连续两次明确为 0 才翻牌，避免一次抖动就把在售商品打成缺货。
 *
 * @param stockCount     本次拿到的库存；null 表示该商品不跟踪库存
 * @param previousOutOfStockStreak 之前连续为 0 的次数
 * @param lowStockThreshold 低库存阈值
 */
export interface StockResolution {
  availability: Availability;
  consecutiveOutOfStock: number;
}

export function resolveAvailability(
  stockCount: number | null,
  previousOutOfStockStreak: number,
  lowStockThreshold: number,
  previousAvailability: Availability = Availability.UNKNOWN,
): StockResolution {
  // 不跟踪库存的商品（不限量卡密等）。
  if (stockCount === null) {
    return {
      availability: Availability.NOT_APPLICABLE,
      consecutiveOutOfStock: 0,
    };
  }

  if (stockCount > 0) {
    return {
      availability:
        stockCount <= lowStockThreshold
          ? Availability.LOW_STOCK
          : Availability.IN_STOCK,
      consecutiveOutOfStock: 0,
    };
  }

  // stockCount === 0：需要连续两次确认。
  const streak = previousOutOfStockStreak + 1;
  if (streak >= 2) {
    return {
      availability: Availability.OUT_OF_STOCK,
      consecutiveOutOfStock: streak,
    };
  }

  // 第一次为 0：保留上一次的可信状态，前台显示"库存状态变化待确认"。
  return {
    availability:
      previousAvailability === Availability.UNKNOWN
        ? Availability.UNKNOWN
        : previousAvailability,
    consecutiveOutOfStock: streak,
  };
}

/**
 * 点击前实时确认走的是另一条路径（spec §16.2）：
 * 用户正等着跳转，这一刻明确返回 0 就可以立即拦截，不必等第二次。
 */
export function resolveAvailabilityForClick(
  stockCount: number | null,
  lowStockThreshold: number,
): Availability {
  if (stockCount === null) return Availability.NOT_APPLICABLE;
  if (stockCount === 0) return Availability.OUT_OF_STOCK;
  return stockCount <= lowStockThreshold
    ? Availability.LOW_STOCK
    : Availability.IN_STOCK;
}

/**
 * 大面积异常保护（spec §16.3）。
 * 一次完整同步如果"全灭"，几乎可以肯定是我们这边的问题而不是所有商品同时下架。
 */
export interface BulkSanityInput {
  itemsSeen: number;
  itemsOutOfStock: number;
  previousItemCount: number;
}

export function isBulkAnomaly({
  itemsSeen,
  itemsOutOfStock,
  previousItemCount,
}: BulkSanityInput): boolean {
  if (itemsSeen === 0 && previousItemCount > 0) return true;

  // 全部商品同时变成 0。
  if (itemsSeen > 0 && itemsOutOfStock === itemsSeen && itemsSeen > 1) {
    return true;
  }

  // 返回数量异常下降超过 80%。
  if (previousItemCount > 0) {
    const dropRatio = (previousItemCount - itemsSeen) / previousItemCount;
    if (dropRatio > 0.8) return true;
  }

  return false;
}

/** 前台文案（spec §7.5）。 */
export interface DisplayStateInput {
  sourceStatus: SourceStatus;
  availability: Availability;
  syncStatus: SyncStatus;
  freshness: Freshness;
  lastSuccessAt: Date | null;
}

export interface DisplayState {
  /** 机器可读的展示分类，前端据此上色/选图标。 */
  tone: "AVAILABLE" | "LOW" | "UNAVAILABLE" | "INACTIVE" | "CHECKING" | "UNKNOWN";
  /** 主文案，例如 "有货"。 */
  label: string;
  /** 是否允许直接跳转。 */
  canRedirect: boolean;
}

export function resolveDisplayState(input: DisplayStateInput): DisplayState {
  const { sourceStatus, availability, syncStatus, freshness } = input;

  // 登录失效：状态更新暂停，但仍展示上次可信结果。
  if (syncStatus === SyncStatus.AUTH_REQUIRED) {
    return { tone: "UNKNOWN", label: "状态更新暂停", canRedirect: true };
  }

  if (syncStatus === SyncStatus.CHECKING) {
    return { tone: "CHECKING", label: "状态确认中", canRedirect: true };
  }

  // 远端已下架是明确信息，优先于库存。
  if (
    sourceStatus === SourceStatus.INACTIVE ||
    sourceStatus === SourceStatus.DELETED
  ) {
    return { tone: "INACTIVE", label: "已下架", canRedirect: false };
  }

  // 请求失败但有旧数据 → 明确告诉用户这是旧值，不假装是实时的。
  if (syncStatus === SyncStatus.ERROR || freshness === "EXPIRED") {
    return { tone: "UNKNOWN", label: "暂时无法确认", canRedirect: true };
  }

  switch (availability) {
    case Availability.IN_STOCK:
      return { tone: "AVAILABLE", label: "有货", canRedirect: true };
    case Availability.LOW_STOCK:
      return { tone: "LOW", label: "库存紧张", canRedirect: true };
    case Availability.OUT_OF_STOCK:
      return { tone: "UNAVAILABLE", label: "暂时缺货", canRedirect: false };
    case Availability.NOT_APPLICABLE:
      return { tone: "AVAILABLE", label: "可查看", canRedirect: true };
    default:
      return { tone: "UNKNOWN", label: "暂时无法确认", canRedirect: true };
  }
}

/** "3 分钟前确认" —— 只做整数粒度，避免前端 hydration 抖动。 */
export function formatConfirmedAt(
  lastSuccessAt: Date | null,
  now: Date = new Date(),
): string | null {
  if (!lastSuccessAt) return null;

  const seconds = Math.floor(
    (now.getTime() - lastSuccessAt.getTime()) / 1000,
  );
  if (seconds < 0) return "刚刚确认";
  if (seconds < 60) return "刚刚确认";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前确认`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前确认`;

  return `${Math.floor(hours / 24)} 天前确认`;
}

/**
 * 组装完整前台文案，例如：
 *   "有货 · 刚刚确认"
 *   "暂时无法确认 · 上次有货，15 分钟前确认"
 */
export function formatDisplayText(
  input: DisplayStateInput,
  now: Date = new Date(),
): string {
  const state = resolveDisplayState(input);
  const confirmed = formatConfirmedAt(input.lastSuccessAt, now);

  if (!confirmed) return state.label;

  // 无法确认时，把上次可信状态一并说清楚，用户才好自己判断。
  if (state.tone === "UNKNOWN" && input.availability !== Availability.UNKNOWN) {
    const last = lastKnownLabel(input.availability);
    if (last) return `${state.label} · 上次${last}，${confirmed}`;
  }

  return `${state.label} · ${confirmed}`;
}

function lastKnownLabel(availability: Availability): string | null {
  switch (availability) {
    case Availability.IN_STOCK:
      return "有货";
    case Availability.LOW_STOCK:
      return "库存紧张";
    case Availability.OUT_OF_STOCK:
      return "缺货";
    default:
      return null;
  }
}
