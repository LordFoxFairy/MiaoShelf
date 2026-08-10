import type Decimal from "decimal.js";
import type { Availability, SourceStatus } from "@/lib/enums";

/**
 * 货源 Connector 的通用契约。
 *
 * 链动小铺（LDXP）只是第一个实现，后面还会接别的平台。所以：
 *  - 同步引擎、导入流程、Worker 只依赖这个接口，不认识任何具体平台
 *  - 平台特有的字段名（agent_price1、extend.stock_count、code:1 信封……）
 *    一律在各自的 Adapter 内部消化，绝不外泄
 *  - 新增平台 = 新写一个实现 + 注册，不改引擎
 *
 * 换句话说：这个文件里出现任何 "ldxp" 字样都是设计事故。
 */

/** 平台标识。 */
export type ProviderId = "LDXP_MERCHANT" | "LDXP_SHOP" | "MOCK";

/** 连接器错误分类，供重试、限流和状态提示使用。 */
export type FailureKind =
  | "NETWORK"
  | "TIMEOUT"
  | "AUTH"
  | "FORBIDDEN"
  | "RATE_LIMIT"
  | "SERVER"
  | "SCHEMA"
  | "CAPTCHA"
  | "UNKNOWN";

/** 归一化后的货源商品。各平台的原始结构都要映射成这个形状。 */
export interface NormalizedGoods {
  /** 平台内唯一 ID。 */
  externalId: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  /** 成本/进货价。用 Decimal 传递，禁止 number。 */
  price: Decimal | null;
  /**
   * 库存数量。
   * null 有明确语义：该商品不跟踪库存（不限量），不是"查不到"。
   * 查不到应该走 ConnectorFailure，而不是塞个 null 进来。
   */
  stockCount: number | null;
  sourceStatus: SourceStatus;
  /** 平台直接给出的库存状态；给不出就留 null，由上层按 stockCount 推导。 */
  availabilityHint: Availability | null;
  goodsType: string | null;
  /** 商品跳转地址。 */
  url: string | null;
  /** 完整原始响应，原样存进 rawPayload 供排查和字段演进。 */
  raw: unknown;
}

/** 搜索结果分页。 */
export interface NormalizedPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  /** 平台给不出总数时为 null，UI 要能接受"不知道总共多少页"。 */
  total: number | null;
  hasMore: boolean;
}

/** 搜索条件。各平台按自己的能力尽量映射，不支持的条件由上层兜底过滤。 */
export interface SearchCriteria {
  keywords?: string;
  goodsType?: string;
  page: number;
  pageSize: number;
}

/** 解析出的跳转链接。 */
export interface ResolvedLink {
  url: string | null;
  shortUrl: string | null;
}

/** 会话校验结果。 */
export interface SessionCheck {
  valid: boolean;
  /** 需要人工验证（验证码/风控）时为 true —— 此时禁止自动重试。 */
  needsVerification: boolean;
  message?: string;
}

/**
 * 平台调用失败。
 *
 * 关键约定：任何 ConnectorFailure 都不允许被上层解释成"缺货"。
 * 缺货只能来自一次成功的响应里明确的 stockCount === 0。
 */
export class ConnectorError extends Error {
  readonly kind: FailureKind;
  readonly statusCode: number | null;
  /** 已脱敏的响应片段，用于排查；绝不含 Cookie/Token。 */
  readonly detail: string | null;

  constructor(
    kind: FailureKind,
    message: string,
    options: { statusCode?: number | null; detail?: string | null; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ConnectorError";
    this.kind = kind;
    this.statusCode = options.statusCode ?? null;
    this.detail = options.detail ?? null;
  }

  /** 这类错误说明需要重新登录，调度器应停止自动排队。 */
  get requiresReauth(): boolean {
    return this.kind === "AUTH" || this.kind === "FORBIDDEN";
  }
}

/** 连接器运行所需的凭据（已解密）。绝不写日志。 */
export interface ConnectorCredentials {
  baseUrl: string;
  username?: string | null;
  password?: string | null;
  cookie?: string | null;
  token?: string | null;
}

/**
 * 只读能力：所有平台都必须实现。
 * 第一版只依赖这一组，写操作是可选的。
 */
export interface SourceConnector {
  readonly provider: ProviderId;

  /** 用当前凭据调一个只读接口，确认会话还活着。 */
  verifySession(): Promise<SessionCheck>;

  /** 搜索货源广场。 */
  search(criteria: SearchCriteria): Promise<NormalizedPage<NormalizedGoods>>;

  /** 拉单个商品的最新详情（价格/库存/状态）。 */
  fetchDetail(externalId: string): Promise<NormalizedGoods>;

  /** 拿商品的跳转链接。 */
  resolveLink(externalId: string): Promise<ResolvedLink>;

  /** 可选：完整货源列表，用于定时全量同步。 */
  listAll?(criteria: Omit<SearchCriteria, "keywords">): Promise<NormalizedPage<NormalizedGoods>>;
}

export interface ConnectorRuntimeOptions {
  timeoutMs?: number;
  /** 注入 fetch 便于测试用 Mock Server。 */
  fetchImpl?: typeof fetch;
  /** 每次请求之间的抖动，避免打爆外部接口（spec §12.4）。 */
  jitterMs?: number;
}
