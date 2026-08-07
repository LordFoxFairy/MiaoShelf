import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { PriceMode } from "@/lib/enums";
import { computeDisplayPrice, formatPrice } from "@/lib/pricing";

describe("computeDisplayPrice", () => {
  it("SOURCE 模式直接用货源价", () => {
    const price = computeDisplayPrice({
      mode: PriceMode.SOURCE,
      sourcePrice: "12.30",
      adjustment: null,
    });
    expect(price?.toFixed(2)).toBe("12.30");
  });

  it("FIXED 模式忽略货源价", () => {
    const price = computeDisplayPrice({
      mode: PriceMode.FIXED,
      sourcePrice: "12.30",
      adjustment: "99.00",
    });
    expect(price?.toFixed(2)).toBe("99.00");
  });

  it("MARKUP_PERCENT 按百分比加价", () => {
    const price = computeDisplayPrice({
      mode: PriceMode.MARKUP_PERCENT,
      sourcePrice: "100",
      adjustment: "15",
    });
    expect(price?.toFixed(2)).toBe("115.00");
  });

  it("MARKUP_FIXED 按固定金额加价", () => {
    const price = computeDisplayPrice({
      mode: PriceMode.MARKUP_FIXED,
      sourcePrice: "12.30",
      adjustment: "2.70",
    });
    expect(price?.toFixed(2)).toBe("15.00");
  });

  it("HIDDEN 模式不展示价格", () => {
    expect(
      computeDisplayPrice({
        mode: PriceMode.HIDDEN,
        sourcePrice: "12.30",
        adjustment: null,
      }),
    ).toBeNull();
  });

  it("货源价缺失时不猜价格", () => {
    // 显示一个猜的价格比不显示更糟：用户会以为那是真价。
    expect(
      computeDisplayPrice({
        mode: PriceMode.MARKUP_PERCENT,
        sourcePrice: null,
        adjustment: "10",
      }),
    ).toBeNull();
  });

  it("用 Decimal 避免浮点误差累积", () => {
    // JS 里 0.1 + 0.2 === 0.30000000000000004，加价场景会直接显示错价。
    const price = computeDisplayPrice({
      mode: PriceMode.MARKUP_FIXED,
      sourcePrice: "0.1",
      adjustment: "0.2",
    });
    expect(price?.toFixed(2)).toBe("0.30");
    expect(price).toBeInstanceOf(Decimal);
  });

  it("百分比加价四舍五入到两位", () => {
    const price = computeDisplayPrice({
      mode: PriceMode.MARKUP_PERCENT,
      sourcePrice: "9.99",
      adjustment: "7.5",
    });
    // 9.99 * 1.075 = 10.73925 → 10.74
    expect(price?.toFixed(2)).toBe("10.74");
  });
});

describe("formatPrice", () => {
  it("格式化为两位小数", () => {
    expect(formatPrice(new Decimal("12.3"))).toBe("¥12.30");
  });

  it("null 表示以外部页面为准", () => {
    expect(formatPrice(null)).toBeNull();
  });
});
