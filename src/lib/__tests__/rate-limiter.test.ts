import { describe, expect, it } from "vitest";
import {
  AdaptiveRateLimiter,
  MAX_SAFE_CONCURRENCY,
} from "@/lib/connectors/rate-limiter";

/**
 * 平台确实会返回 429，这些参数取自实测过的实现。
 * 改动前请确认真实行为，不要凭感觉调。
 */
describe("AdaptiveRateLimiter", () => {
  it("成功时逐步加速，但不低于基础延迟", () => {
    const limiter = new AdaptiveRateLimiter({ baseDelayMs: 200 });
    limiter.onServerError(); // 先抬高到 340
    expect(limiter.currentDelayMs).toBe(340);

    limiter.onSuccess(); // 340 * 0.8 = 272
    expect(limiter.currentDelayMs).toBe(272);

    // 一直成功也不会降到基础值以下 —— 否则会越跑越快直到被限流。
    for (let i = 0; i < 20; i += 1) limiter.onSuccess();
    expect(limiter.currentDelayMs).toBe(200);
  });

  it("429 时退避并且不低于 1500ms", () => {
    const limiter = new AdaptiveRateLimiter({ baseDelayMs: 200 });
    limiter.onRateLimited();
    // 200 * 1.7 = 340，但 429 有 1500ms 下限
    expect(limiter.currentDelayMs).toBe(1500);
  });

  it("连续 429 持续放大延迟", () => {
    const limiter = new AdaptiveRateLimiter({ baseDelayMs: 200 });
    limiter.onRateLimited();
    limiter.onRateLimited();
    // 1500 * 1.7 = 2550
    expect(limiter.currentDelayMs).toBe(2550);
  });

  it("退避不超过上限", () => {
    const limiter = new AdaptiveRateLimiter({
      baseDelayMs: 200,
      maxDelayMs: 5000,
    });
    for (let i = 0; i < 20; i += 1) limiter.onRateLimited();
    expect(limiter.currentDelayMs).toBe(5000);
  });

  it("429 触发全局冷却", () => {
    const limiter = new AdaptiveRateLimiter({ cooldownMs: 30_000 });
    let clock = 1_000_000;
    const now = () => clock;

    expect(limiter.isCoolingDown(now)).toBe(false);

    limiter.onRateLimited(now);
    expect(limiter.isCoolingDown(now)).toBe(true);

    // 冷却期内仍然是暂停状态
    clock += 29_000;
    expect(limiter.isCoolingDown(now)).toBe(true);

    // 冷却结束后恢复
    clock += 2_000;
    expect(limiter.isCoolingDown(now)).toBe(false);
  });

  it("网络错误的退避比 429 温和", () => {
    const network = new AdaptiveRateLimiter({ baseDelayMs: 1000 });
    const server = new AdaptiveRateLimiter({ baseDelayMs: 1000 });

    network.onNetworkError(); // ×1.35
    server.onServerError(); // ×1.7

    expect(network.currentDelayMs).toBeLessThan(server.currentDelayMs);
  });

  it("网络错误不触发冷却 —— 那是我们这边的问题，不是被限流", () => {
    const limiter = new AdaptiveRateLimiter();
    limiter.onNetworkError();
    expect(limiter.isCoolingDown()).toBe(false);
  });

  it("reset 回到初始状态", () => {
    const limiter = new AdaptiveRateLimiter({ baseDelayMs: 200 });
    limiter.onRateLimited();
    limiter.reset();
    expect(limiter.currentDelayMs).toBe(200);
    expect(limiter.isCoolingDown()).toBe(false);
  });

  it("并发上限保持在实测安全值", () => {
    // 超过 2 会被限流，这个数字不要随便调大。
    expect(MAX_SAFE_CONCURRENCY).toBe(2);
  });
});
