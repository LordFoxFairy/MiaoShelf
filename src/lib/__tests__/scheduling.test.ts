import { describe, expect, it } from "vitest";
import { Availability, SyncStatus } from "@/lib/enums";
import {
  classifyPopularity,
  computeFreshnessWindow,
  computeNextCheckAt,
  DEFAULT_SCHEDULE,
} from "@/lib/scheduling";

const NOW = new Date("2026-08-07T12:00:00Z");
/** 固定随机源，让抖动可预测。 */
const noJitter = () => 0;

function secondsFromNow(date: Date | null): number | null {
  return date ? (date.getTime() - NOW.getTime()) / 1000 : null;
}

describe("computeNextCheckAt", () => {
  const base = {
    syncStatus: SyncStatus.FRESH,
    availability: Availability.IN_STOCK,
    consecutiveFailures: 0,
    consecutiveOutOfStock: 0,
  };

  it("热门商品 1 分钟一次", () => {
    const next = computeNextCheckAt(
      { ...base, popularity: "HOT" },
      NOW,
      DEFAULT_SCHEDULE,
      noJitter,
    );
    expect(secondsFromNow(next)).toBe(60);
  });

  it("普通商品 5 分钟一次", () => {
    const next = computeNextCheckAt(
      { ...base, popularity: "NORMAL" },
      NOW,
      DEFAULT_SCHEDULE,
      noJitter,
    );
    expect(secondsFromNow(next)).toBe(300);
  });

  it("冷门商品 30 分钟一次", () => {
    const next = computeNextCheckAt(
      { ...base, popularity: "COLD" },
      NOW,
      DEFAULT_SCHEDULE,
      noJitter,
    );
    expect(secondsFromNow(next)).toBe(1800);
  });

  it("登录失效时停止自动排队", () => {
    // 继续重试只会刷失败日志，还可能加剧风控。
    const next = computeNextCheckAt(
      { ...base, popularity: "HOT", syncStatus: SyncStatus.AUTH_REQUIRED },
      NOW,
      DEFAULT_SCHEDULE,
      noJitter,
    );
    expect(next).toBeNull();
  });

  it("临时失败按 1m * 2^n 退避", () => {
    const attempt = (failures: number) =>
      secondsFromNow(
        computeNextCheckAt(
          {
            ...base,
            popularity: "NORMAL",
            syncStatus: SyncStatus.ERROR,
            consecutiveFailures: failures,
          },
          NOW,
          DEFAULT_SCHEDULE,
          noJitter,
        ),
      );

    expect(attempt(1)).toBe(120);
    expect(attempt(2)).toBe(240);
    expect(attempt(3)).toBe(480);
  });

  it("退避不超过 30 分钟上限", () => {
    const next = computeNextCheckAt(
      {
        ...base,
        popularity: "NORMAL",
        syncStatus: SyncStatus.ERROR,
        consecutiveFailures: 20,
      },
      NOW,
      DEFAULT_SCHEDULE,
      noJitter,
    );
    expect(secondsFromNow(next)).toBe(1800);
  });

  it("缺货商品从 5 分钟起步逐步退避", () => {
    const outOfStock = (streak: number) =>
      secondsFromNow(
        computeNextCheckAt(
          {
            ...base,
            popularity: "NORMAL",
            availability: Availability.OUT_OF_STOCK,
            consecutiveOutOfStock: streak,
          },
          NOW,
          DEFAULT_SCHEDULE,
          noJitter,
        ),
      );

    expect(outOfStock(1)).toBe(300);
    expect(outOfStock(2)).toBe(600);
    expect(outOfStock(3)).toBe(1200);
    expect(outOfStock(10)).toBe(1800);
  });

  it("加入抖动避免所有任务同时触发", () => {
    // 没有抖动的话，一批同时导入的商品会永远同步触发，形成周期性尖峰。
    const next = computeNextCheckAt(
      { ...base, popularity: "HOT" },
      NOW,
      DEFAULT_SCHEDULE,
      () => 0.99,
    );
    const delta = secondsFromNow(next)!;
    expect(delta).toBeGreaterThan(60);
    expect(delta).toBeLessThanOrEqual(75);
  });
});

describe("classifyPopularity", () => {
  it("30 分钟内被访问过算热门", () => {
    expect(
      classifyPopularity(new Date("2026-08-07T11:40:00Z"), NOW),
    ).toBe("HOT");
  });

  it("超过 24 小时没人看算冷门", () => {
    expect(
      classifyPopularity(new Date("2026-08-05T12:00:00Z"), NOW),
    ).toBe("COLD");
  });

  it("从没被访问过算冷门", () => {
    expect(classifyPopularity(null, NOW)).toBe("COLD");
  });
});

describe("computeFreshnessWindow", () => {
  it("热门商品新鲜期更短，保证状态更准", () => {
    const { freshUntil, staleUntil } = computeFreshnessWindow("HOT", NOW);
    expect(secondsFromNow(freshUntil)).toBe(30);
    expect(secondsFromNow(staleUntil)).toBe(300);
  });

  it("普通商品 2 分钟新鲜、15 分钟过期", () => {
    const { freshUntil, staleUntil } = computeFreshnessWindow("NORMAL", NOW);
    expect(secondsFromNow(freshUntil)).toBe(120);
    expect(secondsFromNow(staleUntil)).toBe(900);
  });
});
