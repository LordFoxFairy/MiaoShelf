/**
 * 自适应限流（AIMD）。
 *
 * 小铺确实会返回 429 —— 这不是猜的，参数取自实测过的开源实现。
 * 之前只有固定抖动，批量导入时很容易被限流打断。
 *
 * 策略：
 *   成功    → 延迟 ×0.8，逐步加速，但不低于基础值
 *   429     → 延迟 ×1.7，且不低于 1500ms
 *   5xx     → 延迟 ×1.7
 *   网络错误 → 延迟 ×1.35
 *
 * 遇到 429 还会触发全局冷却，把整批任务暂停一段时间，
 * 而不是继续往枪口上撞。
 */

export interface RateLimiterConfig {
  /** 基础延迟，也是加速的下限。 */
  baseDelayMs: number;
  maxDelayMs: number;
  /** 429 之后的最小延迟。 */
  rateLimitFloorMs: number;
  /** 遇到 429 后全局暂停多久。 */
  cooldownMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimiterConfig = {
  baseDelayMs: 200,
  maxDelayMs: 30_000,
  rateLimitFloorMs: 1500,
  cooldownMs: 30_000,
};

/** 并发上限。实测超过 2 就不安全。 */
export const MAX_SAFE_CONCURRENCY = 2;

const SUCCESS_FACTOR = 0.8;
const RATE_LIMIT_FACTOR = 1.7;
const NETWORK_ERROR_FACTOR = 1.35;

export class AdaptiveRateLimiter {
  private delayMs: number;
  private cooldownUntil = 0;
  private readonly config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMIT, ...config };
    this.delayMs = this.config.baseDelayMs;
  }

  /** 请求前调用：按当前节奏等待，冷却期内则等到冷却结束。 */
  async waitTurn(now: () => number = Date.now): Promise<void> {
    const remaining = this.cooldownUntil - now();
    if (remaining > 0) {
      await sleep(remaining);
    }
    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }
  }

  onSuccess(): void {
    this.delayMs = Math.max(
      this.config.baseDelayMs,
      Math.round(this.delayMs * SUCCESS_FACTOR),
    );
  }

  /** 429：加大延迟并触发全局冷却。 */
  onRateLimited(now: () => number = Date.now): void {
    this.delayMs = Math.min(
      this.config.maxDelayMs,
      Math.max(
        this.config.rateLimitFloorMs,
        Math.round(this.delayMs * RATE_LIMIT_FACTOR),
      ),
    );
    this.cooldownUntil = now() + this.config.cooldownMs;
  }

  onServerError(): void {
    this.delayMs = Math.min(
      this.config.maxDelayMs,
      Math.round(this.delayMs * RATE_LIMIT_FACTOR),
    );
  }

  onNetworkError(): void {
    this.delayMs = Math.min(
      this.config.maxDelayMs,
      Math.round(this.delayMs * NETWORK_ERROR_FACTOR),
    );
  }

  /** 冷却中说明刚被限流，调用方应停止继续发请求。 */
  isCoolingDown(now: () => number = Date.now): boolean {
    return this.cooldownUntil > now();
  }

  get currentDelayMs(): number {
    return this.delayMs;
  }

  reset(): void {
    this.delayMs = this.config.baseDelayMs;
    this.cooldownUntil = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
