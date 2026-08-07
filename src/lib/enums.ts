/**
 * 状态枚举 —— 与 Prisma schema 中的 enum 一一对应。
 *
 * 这里刻意用四个独立维度而不是一个布尔值：
 *   PublicationStatus 我们自己决定要不要展示
 *   SourceStatus      外部平台说这个商品还在不在卖
 *   Availability      外部平台说还有没有库存
 *   SyncStatus        我们对上面两个信息有多大把握
 *
 * "查不到" 和 "确认没货" 是完全不同的两件事，必须分开表达，
 * 否则外部接口一抽风就会把整站商品误判成缺货（见 spec §16.3）。
 */

/** 本站发布状态：管理员控制。 */
export const PublicationStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  HIDDEN: "HIDDEN",
} as const;
export type PublicationStatus =
  (typeof PublicationStatus)[keyof typeof PublicationStatus];

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

/** 我们对当前数据的信心程度。 */
export const SyncStatus = {
  /** now <= freshUntil，可直接使用。 */
  FRESH: "FRESH",
  /** 正在刷新中。 */
  CHECKING: "CHECKING",
  /** 过期，可先展示旧值同时后台刷新。 */
  STALE: "STALE",
  /** 刷新失败，旧值仍然保留。 */
  ERROR: "ERROR",
  /** 登录失效，停止自动排队直到重新登录。 */
  AUTH_REQUIRED: "AUTH_REQUIRED",
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

/** 货源账号的会话状态。 */
export const SessionStatus = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTED: "CONNECTED",
  /** 遇到验证码/人工验证：停止自动重试，等管理员导入会话。 */
  NEEDS_VERIFICATION: "NEEDS_VERIFICATION",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  ERROR: "ERROR",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** 价格展示规则。 */
export const PriceMode = {
  SOURCE: "SOURCE",
  FIXED: "FIXED",
  MARKUP_PERCENT: "MARKUP_PERCENT",
  MARKUP_FIXED: "MARKUP_FIXED",
  HIDDEN: "HIDDEN",
} as const;
export type PriceMode = (typeof PriceMode)[keyof typeof PriceMode];

/** 刷新任务的触发来源，决定优先级。 */
export const RefreshTrigger = {
  SCHEDULE: "SCHEDULE",
  MANUAL: "MANUAL",
  PAGE_VIEW: "PAGE_VIEW",
  CLICK_RESOLVE: "CLICK_RESOLVE",
  IMPORT: "IMPORT",
  LOGIN: "LOGIN",
} as const;
export type RefreshTrigger =
  (typeof RefreshTrigger)[keyof typeof RefreshTrigger];

/** 刷新范围。 */
export const RefreshScope = {
  FULL_CATALOG: "FULL_CATALOG",
  PRODUCT_DETAIL: "PRODUCT_DETAIL",
  PRICE_STOCK_STATUS: "PRICE_STOCK_STATUS",
  LINK_ONLY: "LINK_ONLY",
} as const;
export type RefreshScope = (typeof RefreshScope)[keyof typeof RefreshScope];

/** 同步任务运行结果。 */
export const SyncRunStatus = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCESS: "SUCCESS",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
export type SyncRunStatus =
  (typeof SyncRunStatus)[keyof typeof SyncRunStatus];

/** 前台埋点事件类型。 */
export const ClickEventType = {
  VIEW: "VIEW",
  CLICK: "CLICK",
  REDIRECT: "REDIRECT",
  BLOCKED_OUT_OF_STOCK: "BLOCKED_OUT_OF_STOCK",
  UNCONFIRMED: "UNCONFIRMED",
} as const;
export type ClickEventType =
  (typeof ClickEventType)[keyof typeof ClickEventType];

/**
 * 任务优先级（BullMQ 中数字越小越优先）。
 * 用户正在等待的请求必须排在定时任务前面。
 */
export const TRIGGER_PRIORITY: Record<RefreshTrigger, number> = {
  CLICK_RESOLVE: 1,
  MANUAL: 2,
  PAGE_VIEW: 3,
  IMPORT: 4,
  SCHEDULE: 5,
  LOGIN: 6,
};

/** 完整货源列表同步优先级最低，它最慢且没人等。 */
export const FULL_CATALOG_PRIORITY = 8;
