/** 外部平台的销售状态。 */
export const SourceStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  DELETED: "DELETED",
  UNKNOWN: "UNKNOWN",
} as const;
export type SourceStatus = (typeof SourceStatus)[keyof typeof SourceStatus];

/** 库存状态。NOT_APPLICABLE 用于不跟踪库存的商品（如不限量卡密）。 */
export const Availability = {
  IN_STOCK: "IN_STOCK",
  LOW_STOCK: "LOW_STOCK",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  UNKNOWN: "UNKNOWN",
} as const;
export type Availability = (typeof Availability)[keyof typeof Availability];
