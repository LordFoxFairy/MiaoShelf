import { requestJson } from "@/lib/connectors/http";
import { safeErrorDetail } from "@/lib/connectors/normalize";
import {
  ConnectorError,
  type ConnectorCredentials,
  type ConnectorRuntimeOptions,
  type NormalizedGoods,
  type NormalizedPage,
  type ResolvedLink,
  type SearchCriteria,
  type SessionCheck,
  type SourceConnector,
} from "@/lib/connectors/types";
import { AdaptiveRateLimiter } from "@/lib/connectors/rate-limiter";
import { DEFAULT_PAGE_SIZE, LDXP_API, LDXP_STATUS } from "./api";
import {
  flattenCategories,
  isConnected,
  normalizeGoods,
  type FlatCategory,
  type LdxpRawGoods,
} from "./mapping";

/**
 * 链动小铺连接器（只读）。
 *
 * 写操作（对接货源、改价、上下架）单独放在 writer.ts，
 * 且必须在 ENABLE_LDXP_WRITE 开关之后。
 *
 * 小铺接口的两个硬性特征：
 *  - 全部是 POST，连查询也是
 *  - 认证要同时带 Cookie 和 Merchant-Token
 */
export class LdxpConnector implements SourceConnector {
  readonly provider = "LDXP_MERCHANT" as const;

  private readonly credentials: ConnectorCredentials;
  private readonly options: ConnectorRuntimeOptions;
  private readonly lowStockThreshold: number;
  private readonly limiter: AdaptiveRateLimiter;

  constructor(
    credentials: ConnectorCredentials,
    options: ConnectorRuntimeOptions & { lowStockThreshold?: number } = {},
  ) {
    this.credentials = credentials;
    this.options = options;
    this.lowStockThreshold = options.lowStockThreshold ?? 5;
    this.limiter = new AdaptiveRateLimiter({
      baseDelayMs: options.jitterMs ?? 200,
    });
  }

  /**
   * 统一的请求出口：拼 URL、带认证、限流、解信封。
   *
   * 平台会返回 429，所以每次请求都过自适应限流器：
   * 成功就加速，被限流就退避并触发冷却。
   */
  protected async post<T = unknown>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (!path.startsWith("/merchantApi/")) {
      // 防止拼接错误把请求打到别的路径去。
      throw new ConnectorError("UNKNOWN", `非法接口路径：${path}`);
    }

    const base = this.credentials.baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      Origin: base,
      Referer: `${base}/merchant/`,
    };

    if (this.credentials.cookie) {
      headers.Cookie = this.credentials.cookie;
    }
    if (this.credentials.token) {
      headers["Merchant-Token"] = this.credentials.token;
      // 平台两种都认，一起带上更稳。
      headers.Authorization = `Bearer ${this.credentials.token}`;
    }

    if (!headers.Cookie && !headers["Merchant-Token"]) {
      throw new ConnectorError(
        "AUTH",
        "缺少登录会话，请先登录或导入 Cookie / Merchant-Token",
      );
    }

    await this.limiter.waitTurn();

    try {
      const result = await requestJson(`${base}${path}`, {
        method: "POST",
        headers,
        body,
        timeoutMs: this.options.timeoutMs ?? 15000,
        fetchImpl: this.options.fetchImpl,
      });

      this.limiter.onSuccess();
      return this.unwrap<T>(result.json, path);
    } catch (error) {
      if (error instanceof ConnectorError) {
        if (error.kind === "RATE_LIMIT") this.limiter.onRateLimited();
        else if (error.kind === "SERVER") this.limiter.onServerError();
        else if (error.kind === "NETWORK" || error.kind === "TIMEOUT") {
          this.limiter.onNetworkError();
        }
      }
      throw error;
    }
  }

  /** 刚被限流时应当停止继续发请求（spec §16.3）。 */
  get isCoolingDown(): boolean {
    return this.limiter.isCoolingDown();
  }

  /**
   * 解 {code, data, msg} 信封。
   * code === 1 是唯一的成功值，其余一律按业务失败处理。
   */
  private unwrap<T>(json: unknown, path: string): T {
    if (!json || typeof json !== "object") {
      throw new ConnectorError("SCHEMA", `${path} 返回结构异常`);
    }

    const envelope = json as { code?: unknown; data?: unknown; msg?: unknown };
    const code = Number(envelope.code);

    if (code === 1) return envelope.data as T;

    const message =
      typeof envelope.msg === "string" && envelope.msg
        ? envelope.msg
        : `接口返回 code=${envelope.code}`;

    // 小铺不区分错误码，只能靠文案粗判是不是登录问题。
    const looksLikeAuth = /登录|未授权|token|失效|重新/i.test(message);
    throw new ConnectorError(looksLikeAuth ? "AUTH" : "UNKNOWN", message, {
      detail: safeErrorDetail(message),
    });
  }

  async verifySession(): Promise<SessionCheck> {
    try {
      // userinfo 是最轻的只读接口，探活开销最小。
      await this.post(LDXP_API.userInfo, {});
      return { valid: true, needsVerification: false };
    } catch (error) {
      if (error instanceof ConnectorError) {
        return {
          valid: false,
          // 403 / HTML 页面基本可以确定是风控或验证码。
          needsVerification: error.kind === "FORBIDDEN",
          message: error.message,
        };
      }
      throw error;
    }
  }

  /** 货源广场搜索。注意 name 固定传空串，关键词走 keywords。 */
  async search(criteria: SearchCriteria): Promise<NormalizedPage<NormalizedGoods>> {
    const pageSize = criteria.pageSize || DEFAULT_PAGE_SIZE;

    const data = await this.post<{ list?: unknown[]; total?: unknown }>(
      LDXP_API.sourceSearch,
      {
        current: criteria.page,
        pageSize,
        name: "",
        goods_type: criteria.goodsType || "card",
        keywords: criteria.keywords ?? "",
      },
    );

    return this.toPage(data, criteria.page, pageSize);
  }

  /** 我的商品列表（已对接到自己店铺的商品）。 */
  async listAll(
    criteria: Omit<SearchCriteria, "keywords"> & {
      status?: number;
      categoryId?: string;
      isProxy?: string;
    },
  ): Promise<NormalizedPage<NormalizedGoods>> {
    const pageSize = criteria.pageSize || DEFAULT_PAGE_SIZE;

    const data = await this.post<{ list?: unknown[]; total?: unknown }>(
      LDXP_API.goodsList,
      {
        current: criteria.page,
        pageSize,
        goods_type: criteria.goodsType || "card",
        // 999 = 全部状态
        status: criteria.status ?? LDXP_STATUS.QUERY_ALL,
        name: "",
        // 没有分类筛选时必须省略而不是传 null
        ...(criteria.categoryId
          ? { category_id: Number(criteria.categoryId) }
          : {}),
        // 注意这个是字符串，不是数字
        is_proxy: criteria.isProxy ?? "1",
      },
    );

    return this.toPage(data, criteria.page, pageSize);
  }

  async fetchDetail(externalId: string): Promise<NormalizedGoods> {
    const data = await this.post<LdxpRawGoods>(LDXP_API.goodsInfo, {
      id: Number(externalId) || externalId,
    });

    if (!data || typeof data !== "object") {
      throw new ConnectorError("SCHEMA", `商品 ${externalId} 详情为空`);
    }

    // info 有时不带 id，补上以免下游拿不到。
    return normalizeGoods(
      { ...data, id: data.id ?? externalId },
      { lowStockThreshold: this.lowStockThreshold },
    );
  }

  async resolveLink(externalId: string): Promise<ResolvedLink> {
    const data = await this.post<{ link?: string; short_link?: string }>(
      LDXP_API.goodsLink,
      { id: Number(externalId) || externalId },
    );

    return {
      url: data?.link ?? null,
      shortUrl: data?.short_link ?? null,
    };
  }

  /** 分类树。返回的 data 直接就是树，不包在 list 里。 */
  async listCategories(goodsType = "card"): Promise<FlatCategory[]> {
    const data = await this.post<unknown>(LDXP_API.categoryList, {
      goods_type: goodsType,
    });
    return flattenCategories(data);
  }

  /**
   * 取消对接：解除小铺那边的货源绑定（写操作）。
   *
   * 注意这不是"删除商品" —— 平台没有删除商品的接口。
   * 调用方必须先检查 ENABLE_LDXP_WRITE 开关（spec §9.4）。
   */
  async disconnectGoods(externalId: string): Promise<void> {
    await this.post(LDXP_API.sourceDisconnect, {
      goods_id: Number(externalId) || externalId,
    });
  }

  /** 已对接判断供 UI 显示"已导入/未导入"。 */
  static isConnected(raw: LdxpRawGoods): boolean {
    return isConnected(raw);
  }

  private toPage(
    data: { list?: unknown[]; total?: unknown } | null,
    page: number,
    pageSize: number,
  ): NormalizedPage<NormalizedGoods> {
    const list = Array.isArray(data?.list) ? data.list : [];

    const items = list
      .filter((row): row is LdxpRawGoods => Boolean(row) && typeof row === "object")
      .map((row) =>
        normalizeGoods(row, { lowStockThreshold: this.lowStockThreshold }),
      )
      // 没有 id 的行没法去重和更新，直接丢掉。
      .filter((item) => item.externalId);

    // total 不总是可靠，源码里也做了兜底。
    const total = Number(data?.total);

    return {
      items,
      page,
      pageSize,
      total: Number.isFinite(total) && total > 0 ? total : null,
      // 短页说明到底了（源码同样的判断）
      hasMore: list.length >= pageSize,
    };
  }
}

export function createLdxpConnector(
  credentials: ConnectorCredentials,
  options?: ConnectorRuntimeOptions,
): SourceConnector {
  return new LdxpConnector(credentials, options ?? {});
}
