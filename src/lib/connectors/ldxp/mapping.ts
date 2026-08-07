import Decimal from "decimal.js";
import { Availability, SourceStatus } from "@/lib/enums";
import { parsePrice, parseStock, pickString } from "@/lib/connectors/normalize";
import type { NormalizedGoods } from "@/lib/connectors/types";
import { LDXP_STATUS } from "./api";

/**
 * 小铺原始对象 → 归一化商品。
 *
 * 这个文件集中处理小铺接口的所有怪癖，外面的代码一个都不用知道：
 *  1. 成本价是优先级链，cost_price 经常缺失
 *  2. 库存有两个字段，且两处代码优先级不一致
 *  3. 分类经常不在列表响应里
 *  4. child 有值表示已对接
 */

/** 小铺原始商品对象。字段全是可选的——真实响应经常缺字段。 */
export interface LdxpRawGoods {
  id?: string | number;
  name?: string;
  goods_type?: string;
  /** 我的商品列表用 price，货源搜索用 cost_price 那套 */
  price?: string | number;
  cost_price?: string | number | null;
  agent_price_limit?: string | number | null;
  agent_price1?: string | number | null;
  agent_price2?: string | number | null;
  agent_price3?: string | number | null;
  stock_count?: string | number | null;
  extend?: { stock_count?: string | number | null } | null;
  status?: string | number;
  link?: string;
  short_link?: string;
  user?: { nickname?: string } | null;
  /** 有值 = 已对接到自己店铺 */
  child?: unknown;
  [key: string]: unknown;
}

/**
 * 成本价优先级链。
 * 源码里是取第一个非 null 且非负的值 —— cost_price 常常不存在，
 * 直接读它会得到一堆没有价格的商品。
 */
export function resolveCostPrice(raw: LdxpRawGoods): Decimal | null {
  const candidates = [
    raw.cost_price,
    raw.agent_price_limit,
    raw.agent_price1,
    raw.agent_price2,
    raw.agent_price3,
  ];

  for (const candidate of candidates) {
    const price = parsePrice(candidate);
    if (price !== null && price.greaterThanOrEqualTo(0)) return price;
  }
  return null;
}

/**
 * 库存。
 *
 * 两个字段都要读：小铺自己的两处代码优先级不一致
 * （搜索偏好 stock_count，商品列表偏好 extend.stock_count），
 * 所以这里取"第一个能解析出来的"，而不是固定某个顺序。
 *
 * @returns undefined 表示两个字段都没给（查不到，不是没货）
 */
export function resolveStock(
  raw: LdxpRawGoods,
  goodsType: string | null,
): number | null | undefined {
  // 非卡密商品不跟踪库存，返回 null 表示"不限量"而不是"缺货"。
  if (goodsType && goodsType !== "card") return null;

  const direct = parseStock(raw.stock_count);
  if (direct !== undefined) return direct;

  const extended = parseStock(raw.extend?.stock_count);
  if (extended !== undefined) return extended;

  return undefined;
}

/** status: 1=销售中，0=仓库中。认不出来一律 UNKNOWN，绝不猜成下架。 */
export function resolveSourceStatus(raw: LdxpRawGoods): SourceStatus {
  if (raw.status === undefined || raw.status === null) {
    return SourceStatus.UNKNOWN;
  }

  const status = Number(raw.status);
  if (status === LDXP_STATUS.ON_SALE) return SourceStatus.ACTIVE;
  if (status === LDXP_STATUS.IN_WAREHOUSE) return SourceStatus.INACTIVE;
  return SourceStatus.UNKNOWN;
}

/** child 有值 = 已经对接到自己店铺。 */
export function isConnected(raw: LdxpRawGoods): boolean {
  return Boolean(raw.child);
}

export function normalizeGoods(
  raw: LdxpRawGoods,
  options: { lowStockThreshold: number },
): NormalizedGoods {
  const goodsType = pickString(raw.goods_type);
  const stockCount = resolveStock(raw, goodsType);

  // 我的商品列表用 price 字段，货源搜索用成本价链。
  const price = parsePrice(raw.price) ?? resolveCostPrice(raw);

  return {
    externalId: String(raw.id ?? ""),
    title: pickString(raw.name),
    description: null,
    imageUrl: null,
    price,
    // undefined（查不到）统一成 null 交给上层，但上层拿到的
    // availabilityHint 会是 null，表示"别下结论"。
    stockCount: stockCount === undefined ? null : stockCount,
    sourceStatus: resolveSourceStatus(raw),
    availabilityHint: hintFromStock(stockCount, options.lowStockThreshold),
    goodsType,
    url: pickString(raw.link, raw.short_link),
    raw,
  };
}

/**
 * 由库存推导展示状态。
 * 字段缺失时返回 null —— 让上层走"无法确认"分支，而不是当成缺货。
 */
function hintFromStock(
  stockCount: number | null | undefined,
  lowStockThreshold: number,
): Availability | null {
  if (stockCount === undefined) return null;
  if (stockCount === null) return Availability.NOT_APPLICABLE;
  if (stockCount === 0) return Availability.OUT_OF_STOCK;
  return stockCount <= lowStockThreshold
    ? Availability.LOW_STOCK
    : Availability.IN_STOCK;
}

/**
 * 分类树扁平化。
 *
 * 节点结构不统一，id 可能叫 value 或 id，label 可能叫 label 或 name，
 * 子节点可能叫 children / child / list —— 全都要试。
 */
export interface FlatCategory {
  id: string;
  name: string;
  depth: number;
}

export function flattenCategories(
  nodes: unknown,
  depth = 0,
): FlatCategory[] {
  if (!Array.isArray(nodes)) return [];

  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;

    const id = record.value ?? record.id;
    const name = record.label ?? record.name;
    if (id === undefined || id === null) return [];

    const children = record.children ?? record.child ?? record.list;

    return [
      { id: String(id), name: String(name ?? id), depth },
      ...flattenCategories(children, depth + 1),
    ];
  });
}

/**
 * 商品的分类 ID。
 * 列表响应经常不带分类，且字段名有六七种写法，逐个试。
 */
export function resolveCategoryId(raw: LdxpRawGoods): string | null {
  const candidates = [
    raw.category_id,
    raw.goods_category_id,
    raw.categoryId,
    raw.cate_id,
    (raw.category as Record<string, unknown> | undefined)?.id,
    (raw.category as Record<string, unknown> | undefined)?.value,
    // category 有时直接是个数字字符串
    typeof raw.category === "string" || typeof raw.category === "number"
      ? raw.category
      : undefined,
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      return String(candidate);
    }
  }
  return null;
}
