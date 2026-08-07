import { describe, expect, it } from "vitest";
import {
  Availability,
  SourceStatus,
  SyncStatus,
} from "@/lib/enums";
import {
  computeFreshness,
  formatConfirmedAt,
  formatDisplayText,
  isBulkAnomaly,
  resolveAvailability,
  resolveAvailabilityForClick,
  resolveDisplayState,
  syncStatusForFailure,
  type FailureKind,
} from "@/lib/freshness";

const NOW = new Date("2026-08-07T12:00:00Z");

describe("computeFreshness", () => {
  it("在 freshUntil 之前是 FRESH —— 可以直接对用户声称有货", () => {
    expect(
      computeFreshness(
        {
          freshUntil: new Date("2026-08-07T12:02:00Z"),
          staleUntil: new Date("2026-08-07T12:15:00Z"),
        },
        NOW,
      ),
    ).toBe("FRESH");
  });

  it("超过 freshUntil 但未超 staleUntil 是 STALE —— 展示旧值同时后台刷新", () => {
    expect(
      computeFreshness(
        {
          freshUntil: new Date("2026-08-07T11:59:00Z"),
          staleUntil: new Date("2026-08-07T12:15:00Z"),
        },
        NOW,
      ),
    ).toBe("STALE");
  });

  it("超过 staleUntil 是 EXPIRED —— 不再声称有货", () => {
    expect(
      computeFreshness(
        {
          freshUntil: new Date("2026-08-07T11:00:00Z"),
          staleUntil: new Date("2026-08-07T11:30:00Z"),
        },
        NOW,
      ),
    ).toBe("EXPIRED");
  });

  it("从未成功同步过时是 EXPIRED，而不是默认可信", () => {
    // 这条很关键：新导入的商品还没同步过，不能因为字段为空就当成有货。
    expect(
      computeFreshness({ freshUntil: null, staleUntil: null }, NOW),
    ).toBe("EXPIRED");
  });
});

describe("resolveAvailability —— 缺货必须连续两次确认", () => {
  it("库存 > 阈值时是 IN_STOCK", () => {
    const result = resolveAvailability(50, 0, 5);
    expect(result.availability).toBe(Availability.IN_STOCK);
    expect(result.consecutiveOutOfStock).toBe(0);
  });

  it("库存低于阈值时是 LOW_STOCK", () => {
    expect(resolveAvailability(3, 0, 5).availability).toBe(
      Availability.LOW_STOCK,
    );
  });

  it("第一次拿到 0 不判缺货，保留上一次可信状态", () => {
    // 外部接口偶发返回 0 很常见，一次就翻牌会造成大量误判。
    const result = resolveAvailability(0, 0, 5, Availability.IN_STOCK);
    expect(result.availability).toBe(Availability.IN_STOCK);
    expect(result.consecutiveOutOfStock).toBe(1);
  });

  it("连续第二次拿到 0 才判定 OUT_OF_STOCK", () => {
    const result = resolveAvailability(0, 1, 5, Availability.IN_STOCK);
    expect(result.availability).toBe(Availability.OUT_OF_STOCK);
    expect(result.consecutiveOutOfStock).toBe(2);
  });

  it("库存恢复后连续计数清零", () => {
    const result = resolveAvailability(10, 5, 5, Availability.OUT_OF_STOCK);
    expect(result.availability).toBe(Availability.IN_STOCK);
    expect(result.consecutiveOutOfStock).toBe(0);
  });

  it("stockCount 为 null 表示不限量，不是缺货", () => {
    expect(resolveAvailability(null, 0, 5).availability).toBe(
      Availability.NOT_APPLICABLE,
    );
  });
});

describe("resolveAvailabilityForClick —— 点击时可以立即拦截", () => {
  it("用户正在等待，明确返回 0 就直接判缺货，不等第二次", () => {
    // 与定时同步的两次确认规则不同：这里宁可误拦一次，
    // 也不能把用户送到一个已经买不到的页面。
    expect(resolveAvailabilityForClick(0, 5)).toBe(Availability.OUT_OF_STOCK);
  });

  it("不限量商品可以跳转", () => {
    expect(resolveAvailabilityForClick(null, 5)).toBe(
      Availability.NOT_APPLICABLE,
    );
  });
});

describe("失败绝不等于缺货", () => {
  const failures: FailureKind[] = [
    "AUTH",
    "FORBIDDEN",
    "RATE_LIMIT",
    "TIMEOUT",
    "NETWORK",
    "SERVER",
    "SCHEMA",
    "UNKNOWN",
  ];

  it("认证类失败进入 AUTH_REQUIRED，等人工重新登录", () => {
    expect(syncStatusForFailure("AUTH")).toBe(SyncStatus.AUTH_REQUIRED);
    expect(syncStatusForFailure("FORBIDDEN")).toBe(SyncStatus.AUTH_REQUIRED);
  });

  it("其余失败进入 ERROR，可自动退避重试", () => {
    for (const kind of failures.filter((k) => k !== "AUTH" && k !== "FORBIDDEN")) {
      expect(syncStatusForFailure(kind)).toBe(SyncStatus.ERROR);
    }
  });

  it("任何失败类型下前台都不显示缺货，而是显示无法确认", () => {
    // 这是整个系统最重要的不变量（spec §7.5）。
    for (const kind of failures) {
      const state = resolveDisplayState({
        sourceStatus: SourceStatus.ACTIVE,
        availability: Availability.IN_STOCK,
        syncStatus: syncStatusForFailure(kind),
        freshness: "STALE",
        lastSuccessAt: new Date("2026-08-07T11:45:00Z"),
      });
      expect(state.label).not.toBe("暂时缺货");
      expect(state.tone).not.toBe("UNAVAILABLE");
    }
  });
});

describe("isBulkAnomaly —— 大面积异常保护", () => {
  it("全部商品同时变成缺货判定为异常", () => {
    expect(
      isBulkAnomaly({ itemsSeen: 40, itemsOutOfStock: 40, previousItemCount: 40 }),
    ).toBe(true);
  });

  it("返回数量暴跌超过 80% 判定为异常", () => {
    expect(
      isBulkAnomaly({ itemsSeen: 5, itemsOutOfStock: 0, previousItemCount: 100 }),
    ).toBe(true);
  });

  it("一个商品也没返回但之前有，判定为异常", () => {
    expect(
      isBulkAnomaly({ itemsSeen: 0, itemsOutOfStock: 0, previousItemCount: 30 }),
    ).toBe(true);
  });

  it("正常波动不算异常", () => {
    expect(
      isBulkAnomaly({ itemsSeen: 38, itemsOutOfStock: 3, previousItemCount: 40 }),
    ).toBe(false);
  });

  it("首次同步（之前为 0）不算异常", () => {
    expect(
      isBulkAnomaly({ itemsSeen: 0, itemsOutOfStock: 0, previousItemCount: 0 }),
    ).toBe(false);
  });
});

describe("前台文案", () => {
  it("远端下架时阻止跳转", () => {
    const state = resolveDisplayState({
      sourceStatus: SourceStatus.INACTIVE,
      availability: Availability.IN_STOCK,
      syncStatus: SyncStatus.FRESH,
      freshness: "FRESH",
      lastSuccessAt: NOW,
    });
    expect(state.label).toBe("已下架");
    expect(state.canRedirect).toBe(false);
  });

  it("确认缺货时阻止跳转", () => {
    const state = resolveDisplayState({
      sourceStatus: SourceStatus.ACTIVE,
      availability: Availability.OUT_OF_STOCK,
      syncStatus: SyncStatus.FRESH,
      freshness: "FRESH",
      lastSuccessAt: NOW,
    });
    expect(state.canRedirect).toBe(false);
  });

  it("无法确认时仍允许用户自主继续", () => {
    // 我们不确定 ≠ 一定没货，不该替用户做决定。
    const state = resolveDisplayState({
      sourceStatus: SourceStatus.ACTIVE,
      availability: Availability.IN_STOCK,
      syncStatus: SyncStatus.ERROR,
      freshness: "EXPIRED",
      lastSuccessAt: new Date("2026-08-07T11:45:00Z"),
    });
    expect(state.label).toBe("暂时无法确认");
    expect(state.canRedirect).toBe(true);
  });

  it("无法确认时把上次可信状态一并说清楚", () => {
    const text = formatDisplayText(
      {
        sourceStatus: SourceStatus.ACTIVE,
        availability: Availability.IN_STOCK,
        syncStatus: SyncStatus.ERROR,
        freshness: "EXPIRED",
        lastSuccessAt: new Date("2026-08-07T11:45:00Z"),
      },
      NOW,
    );
    expect(text).toBe("暂时无法确认 · 上次有货，15 分钟前确认");
  });

  it("正常有货时显示确认时间", () => {
    expect(
      formatDisplayText(
        {
          sourceStatus: SourceStatus.ACTIVE,
          availability: Availability.IN_STOCK,
          syncStatus: SyncStatus.FRESH,
          freshness: "FRESH",
          lastSuccessAt: new Date("2026-08-07T11:57:00Z"),
        },
        NOW,
      ),
    ).toBe("有货 · 3 分钟前确认");
  });

  it("一分钟内显示刚刚确认", () => {
    expect(
      formatConfirmedAt(new Date("2026-08-07T11:59:30Z"), NOW),
    ).toBe("刚刚确认");
  });
});
