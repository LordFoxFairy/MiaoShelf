import { Availability, SyncStatus } from "@/lib/enums";

/**
 * 自适应下次检查时间（spec §12.5、§12.6）。
 *
 * 目标是把有限的外部请求配额花在有人看的商品上：
 * 热门商品 1 分钟一次，冷门商品 30 分钟一次，缺货和失败的逐步退避。
 *
 * 每个结果都加 0~15 秒抖动，否则所有商品会在同一秒集中触发，
 * 对外部接口形成周期性尖峰。
 */

export interface ScheduleConfig {
  hotSeconds: number;
  normalSeconds: number;
  coldSeconds: number;
  /** 退避上限。 */
  maxBackoffSeconds: number;
  jitterSeconds: number;
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  hotSeconds: 60,
  normalSeconds: 300,
  coldSeconds: 1800,
  maxBackoffSeconds: 1800,
  jitterSeconds: 15,
};

export type Popularity = "HOT" | "NORMAL" | "COLD";

export interface NextCheckInput {
  syncStatus: SyncStatus;
  availability: Availability;
  popularity: Popularity;
  consecutiveFailures: number;
  consecutiveOutOfStock: number;
}

/**
 * @param random 注入随机源，让测试可以断言确定的结果。
 * @returns null 表示不要再自动排队（登录失效，等人工处理）。
 */
export function computeNextCheckAt(
  input: NextCheckInput,
  now: Date = new Date(),
  config: ScheduleConfig = DEFAULT_SCHEDULE,
  random: () => number = Math.random,
): Date | null {
  const {
    syncStatus,
    availability,
    popularity,
    consecutiveFailures,
    consecutiveOutOfStock,
  } = input;

  // 登录失效：继续重试只会刷失败日志，等重新登录后再排。
  if (syncStatus === SyncStatus.AUTH_REQUIRED) return null;

  let delaySeconds: number;

  if (syncStatus === SyncStatus.ERROR && consecutiveFailures > 0) {
    // 临时失败：1m * 2^n，上限 30m
    delaySeconds = backoff(60, consecutiveFailures, config.maxBackoffSeconds);
  } else if (availability === Availability.OUT_OF_STOCK) {
    // 缺货：5m 起步逐步退避到 30m
    delaySeconds = backoff(
      300,
      Math.max(0, consecutiveOutOfStock - 1),
      config.maxBackoffSeconds,
    );
  } else {
    delaySeconds =
      popularity === "HOT"
        ? config.hotSeconds
        : popularity === "COLD"
          ? config.coldSeconds
          : config.normalSeconds;
  }

  const jitter = Math.floor(random() * (config.jitterSeconds + 1));
  return new Date(now.getTime() + (delaySeconds + jitter) * 1000);
}

function backoff(baseSeconds: number, exponent: number, maxSeconds: number): number {
  const raw = baseSeconds * Math.pow(2, Math.max(0, exponent));
  return Math.min(raw, maxSeconds);
}

/**
 * 冷热分级（spec §12.5）。
 * @param lastViewedAt 最近一次有人访问或点击的时间
 */
export function classifyPopularity(
  lastViewedAt: Date | null,
  now: Date = new Date(),
): Popularity {
  if (!lastViewedAt) return "COLD";

  const minutesSince = (now.getTime() - lastViewedAt.getTime()) / 60000;
  if (minutesSince <= 30) return "HOT";
  if (minutesSince <= 60 * 24) return "NORMAL";
  return "COLD";
}

/** 根据冷热计算 freshUntil / staleUntil（spec §13.2）。 */
export interface FreshnessWindowConfig {
  freshSeconds: number;
  staleSeconds: number;
  hotFreshSeconds: number;
  hotStaleSeconds: number;
}

export const DEFAULT_FRESHNESS_WINDOW: FreshnessWindowConfig = {
  freshSeconds: 120,
  staleSeconds: 900,
  hotFreshSeconds: 30,
  hotStaleSeconds: 300,
};

export function computeFreshnessWindow(
  popularity: Popularity,
  now: Date = new Date(),
  config: FreshnessWindowConfig = DEFAULT_FRESHNESS_WINDOW,
): { freshUntil: Date; staleUntil: Date } {
  const fresh =
    popularity === "HOT" ? config.hotFreshSeconds : config.freshSeconds;
  const stale =
    popularity === "HOT" ? config.hotStaleSeconds : config.staleSeconds;

  return {
    freshUntil: new Date(now.getTime() + fresh * 1000),
    staleUntil: new Date(now.getTime() + stale * 1000),
  };
}
