import Decimal from "decimal.js";
import { PriceMode } from "@/lib/enums";

/**
 * 价格计算（spec §21）。
 *
 * 全程 Decimal，禁止用 JS number 参与金额运算：
 * 0.1 + 0.2 = 0.30000000000000004 这种误差累积到加价场景会直接显示错价。
 */

export interface PriceInput {
  mode: PriceMode;
  /** 货源价，null 表示还没同步到。 */
  sourcePrice: Decimal.Value | null;
  /** FIXED 模式下的固定价；MARKUP_* 模式下的加价幅度。 */
  adjustment: Decimal.Value | null;
}

/**
 * @returns null 表示不展示价格（HIDDEN，或缺少必要输入）。
 *          调用方应回落到"以外部页面为准"。
 */
export function computeDisplayPrice(input: PriceInput): Decimal | null {
  const { mode, sourcePrice, adjustment } = input;

  if (mode === PriceMode.HIDDEN) return null;

  if (mode === PriceMode.FIXED) {
    return adjustment === null ? null : toDecimal(adjustment);
  }

  // 其余模式都依赖货源价。
  if (sourcePrice === null) return null;
  const base = toDecimal(sourcePrice);

  switch (mode) {
    case PriceMode.SOURCE:
      return round(base);

    case PriceMode.MARKUP_PERCENT: {
      if (adjustment === null) return round(base);
      const pct = toDecimal(adjustment);
      return round(base.times(pct.dividedBy(100).plus(1)));
    }

    case PriceMode.MARKUP_FIXED: {
      if (adjustment === null) return round(base);
      return round(base.plus(toDecimal(adjustment)));
    }

    default:
      return round(base);
  }
}

/** 金额一律两位小数，向上取整避免我们显示的价格低于实际。 */
function round(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function toDecimal(value: Decimal.Value): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** 展示用格式化。返回 null 时前端显示"以外部页面为准"。 */
export function formatPrice(
  price: Decimal | null,
  currencySymbol = "¥",
): string | null {
  if (price === null) return null;
  return `${currencySymbol}${price.toFixed(2)}`;
}
