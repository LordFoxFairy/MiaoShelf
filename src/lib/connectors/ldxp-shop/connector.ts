import { requestJson } from "@/lib/connectors/http";
import { AdaptiveRateLimiter } from "@/lib/connectors/rate-limiter";
import { parsePrice, parseStock, pickString, safeErrorDetail } from "@/lib/connectors/normalize";
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
import { Availability, SourceStatus } from "@/lib/enums";

/**
 * 链动小铺「公开店铺」连接器。
 *
 * 和商家后台连接器的根本区别：**不需要任何登录凭据**。
 * token 就是店铺公开地址里的那段路径：
 *
 *   https://pay.ldxp.cn/shop/miaoli  →  token = "miaoli"
 *
 * 对"展示自己店铺商品"这个场景，这条路比商家后台好得多：
 *  - 不用存密码
 *  - 不会遇到验证码
 *  - 会话不会过期，不会半夜停摆
 *
 * 代价是只能读到店铺公开可见的信息（拿不到成本价、对接关系等）。
 */

const SHOP_API = {
  info: "/shopApi/Shop/info",
  categoryList: "/shopApi/Shop/categoryList",
  goodsList: "/shopApi/Shop/goodsList",
  /** 单品详情，按 goods_key 查，不用翻页。 */
  goodsInfo: "/shopApi/Shop/goodsInfo",
} as const;

/**
 * 商品类型。
 *
 * 必须四种都遍历：实测一个店铺可能 card 有 93 个、equity 有 136 个，
 * 只查默认的一种会漏掉大半商品，还会误判成"店铺是空的"。
 */
const ALL_GOODS_TYPES = ["card", "article", "resource", "equity"] as const;

/** 从店铺地址里解析出 token 和 API 根地址。 */
export function parseShopUrl(shopUrl: string): {
  apiBase: string;
  token: string;
} | null {
  let url: URL;
  try {
    url = new URL(shopUrl);
  } catch {
    return null;
  }

  // /shop/miaoli → token = miaoli
  const segments = url.pathname.split("/").filter(Boolean);
  const shopIndex = segments.indexOf("shop");

  const token =
    shopIndex >= 0 && segments[shopIndex + 1]
      ? segments[shopIndex + 1]!
      : (segments.at(-1) ?? "");

  if (!token) return null;

  return { apiBase: url.origin, token };
}

interface ShopGoods {
  goods_key?: string | number;
  id?: string | number;
  name?: string;
  price?: string | number;
  real_price?: string | number;
  status?: string | number;
  link?: string;
  cover?: string;
  image?: string;
  description?: string;
  goods_type?: string;
  extend?: { stock_count?: string | number | null } | null;
  [key: string]: unknown;
}

export class LdxpShopConnector implements SourceConnector {
  readonly provider = "LDXP_SHOP" as const;

  private readonly apiBase: string;
  private readonly token: string;
  private readonly options: ConnectorRuntimeOptions;
  private readonly lowStockThreshold: number;
  private readonly limiter: AdaptiveRateLimiter;
  /**
   * WAF 放行 cookie（如 acw_tc/cdn_sec_tc/PHPSESSID）。
   * 由本机浏览器过一次 WAF 后导入，服务器带上它，无头纯 HTTP 也能放行。
   * 过期后请求会撞回挑战页，需在本机重新过一次刷新。
   */
  private readonly wafCookie: string | null;
  /** 拿到的分类，用于遍历全部商品。 */
  private categoryCache: string[] | null = null;

  constructor(
    credentials: ConnectorCredentials,
    options: ConnectorRuntimeOptions & { lowStockThreshold?: number } = {},
  ) {
    const parsed = parseShopUrl(credentials.baseUrl);
    if (!parsed) {
      throw new ConnectorError(
        "UNKNOWN",
        `无法从地址解析店铺标识：${credentials.baseUrl}。应形如 https://pay.ldxp.cn/shop/你的店铺名`,
      );
    }

    this.apiBase = parsed.apiBase;
    // token 也允许显式覆盖（凭据里的 username 字段复用为 token）。
    this.token = credentials.username?.trim() || parsed.token;
    this.wafCookie = credentials.cookie?.trim() || null;
    this.options = options;
    this.lowStockThreshold = options.lowStockThreshold ?? 5;
    this.limiter = new AdaptiveRateLimiter({
      baseDelayMs: options.jitterMs ?? 300,
    });
  }

  private async post<T = unknown>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    await this.limiter.waitTurn();

    try {
      const result = await requestJson(`${this.apiBase}${path}`, {
        method: "POST",
        headers: {
          Origin: this.apiBase,
          Referer: `${this.apiBase}/shop/${this.token}`,
          // 带上 WAF 放行 cookie（本机过一次后导入的），无头也能被放行。
          ...(this.wafCookie ? { Cookie: this.wafCookie } : {}),
        },
        body: { token: this.token, ...body },
        timeoutMs: this.options.timeoutMs ?? 15_000,
        fetchImpl: this.options.fetchImpl,
      });

      this.limiter.onSuccess();

      const envelope = result.json as
        | { code?: unknown; data?: unknown; msg?: unknown }
        | undefined;

      if (!envelope || typeof envelope !== "object") {
        throw new ConnectorError("SCHEMA", `${path} 返回结构异常`);
      }

      if (Number(envelope.code) !== 1) {
        const message =
          typeof envelope.msg === "string" && envelope.msg
            ? envelope.msg
            : `接口返回 code=${envelope.code}`;
        throw new ConnectorError("UNKNOWN", message, {
          detail: safeErrorDetail(message),
        });
      }

      return envelope.data as T;
    } catch (error) {
      if (error instanceof ConnectorError) {
        if (error.kind === "RATE_LIMIT") this.limiter.onRateLimited();
        else if (error.kind === "SERVER") this.limiter.onServerError();
        else if (error.kind === "NETWORK" || error.kind === "TIMEOUT") {
          this.limiter.onNetworkError();
        }

        // 这里曾有「撞 WAF 就开浏览器手动过滑块」的兜底。已移除：
        // 实测阿里云 ESA 的滑块过不了（拟人轨迹 + uc 指纹掩蔽都试过），
        // 而采集只在本机跑、IP 干净，根本走不到这条路。
      }
      throw error;
    }
  }

  /** 公开接口没有会话概念，能拿到店铺信息就算通。 */
  async verifySession(): Promise<SessionCheck> {
    try {
      const data = await this.post<{ nickname?: string }>(SHOP_API.info, {});
      return {
        valid: true,
        needsVerification: false,
        message: data?.nickname ? `店铺：${data.nickname}` : undefined,
      };
    } catch (error) {
      if (error instanceof ConnectorError) {
        return {
          valid: false,
          needsVerification: error.kind === "FORBIDDEN",
          message: error.message,
        };
      }
      throw error;
    }
  }

  async getShopName(): Promise<string | null> {
    const data = await this.post<{ nickname?: string }>(SHOP_API.info, {});
    return pickString(data?.nickname);
  }

  /** 店铺分类。用于翻遍所有商品——goodsList 需要按分类查。 */
  async listCategories(goodsType = "card"): Promise<string[]> {
    if (this.categoryCache) return this.categoryCache;

    const data = await this.post<unknown>(SHOP_API.categoryList, {
      goods_type: goodsType,
    });

    const ids: string[] = [];
    const walk = (nodes: unknown) => {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const record = node as Record<string, unknown>;
        const id = record.id ?? record.category_id ?? record.value;
        if (id !== undefined && id !== null) ids.push(String(id));
        walk(record.children ?? record.child ?? record.list);
      }
    };
    walk(data);

    this.categoryCache = ids;
    return ids;
  }

  async search(
    criteria: SearchCriteria,
  ): Promise<NormalizedPage<NormalizedGoods>> {
    const pageSize = criteria.pageSize || 100;

    const data = await this.post<{ list?: unknown[]; total?: unknown }>(
      SHOP_API.goodsList,
      {
        keywords: criteria.keywords ?? "",
        category_id: "",
        goods_type: criteria.goodsType || "card",
        current: criteria.page,
        pageSize,
      },
    );

    return this.toPage(data, criteria.page, pageSize);
  }

  /**
   * 店铺全部商品。
   *
   * 关键：必须遍历全部四种商品类型。实测一个店铺可能
   * card 93 个、equity 136 个 —— 只查一种会漏掉大半，
   * 甚至误判成"店铺是空的"（默认类型恰好没商品时）。
   *
   * 指定了 goodsType 就只查那一种，否则四种都查并合并。
   */
  async listAll(
    criteria: Omit<SearchCriteria, "keywords">,
  ): Promise<NormalizedPage<NormalizedGoods>> {
    if (criteria.goodsType) {
      return this.search({ ...criteria, keywords: undefined });
    }

    const pageSize = criteria.pageSize || 100;
    const all: NormalizedGoods[] = [];
    let total = 0;

    for (const goodsType of ALL_GOODS_TYPES) {
      // 每种类型翻完为止，上限 20 页兜底防止死循环。
      for (let page = 1; page <= 20; page += 1) {
        const result = await this.search({ page, pageSize, goodsType });
        all.push(...result.items);
        if (page === 1 && result.total) total += result.total;
        if (!result.hasMore) break;
      }
    }

    return {
      items: all,
      page: 1,
      pageSize: all.length,
      total: total || all.length,
      hasMore: false,
    };
  }

  /**
   * 单品详情。
   *
   * 注意：goodsInfo 接口**不返回库存**（extend.stock_count 只在列表里有）。
   * 同步时如果只用它，会把已有库存冲掉。所以这里两个都查，
   * 用列表数据补上详情缺的库存字段。
   */
  async fetchDetail(externalId: string): Promise<NormalizedGoods> {
    const data = await this.post<ShopGoods>(SHOP_API.goodsInfo, {
      goods_key: externalId,
    });

    if (!data || typeof data !== "object") {
      throw new ConnectorError(
        "UNKNOWN",
        `店铺中找不到商品 ${externalId}，可能已下架`,
      );
    }

    const detail = this.normalize({
      ...data,
      goods_key: data.goods_key ?? externalId,
    });

    // 详情没给库存就去列表里捞一次，拿不到也不影响其余字段。
    if (detail.stockCount === null) {
      const fromList = await this.findInList(externalId, detail.goodsType);
      if (fromList?.stockCount !== undefined && fromList?.stockCount !== null) {
        return {
          ...detail,
          stockCount: fromList.stockCount,
          availabilityHint: fromList.availabilityHint,
        };
      }
    }

    return detail;
  }

  /** 在列表里找某个商品。列表带库存，详情不带。 */
  private async findInList(
    externalId: string,
    goodsType: string | null,
  ): Promise<NormalizedGoods | null> {
    const types = goodsType ? [goodsType] : ALL_GOODS_TYPES;

    for (const type of types) {
      for (let page = 1; page <= 5; page += 1) {
        const result = await this.search({
          page,
          pageSize: 100,
          goodsType: type,
        }).catch(() => null);
        if (!result) break;

        const hit = result.items.find((item) => item.externalId === externalId);
        if (hit) return hit;
        if (!result.hasMore) break;
      }
    }
    return null;
  }

  async resolveLink(externalId: string): Promise<ResolvedLink> {
    const goods = await this.fetchDetail(externalId).catch(() => null);
    return {
      url: goods?.url ?? `${this.apiBase}/item/${externalId}`,
      shortUrl: null,
    };
  }

  private toPage(
    data: { list?: unknown[]; total?: unknown } | null,
    page: number,
    pageSize: number,
  ): NormalizedPage<NormalizedGoods> {
    const list = Array.isArray(data?.list) ? data.list : [];

    const items = list
      .filter((row): row is ShopGoods => Boolean(row) && typeof row === "object")
      .map((row) => this.normalize(row))
      .filter((item) => item.externalId);

    const total = Number(data?.total);

    return {
      items,
      page,
      pageSize,
      total: Number.isFinite(total) && total > 0 ? total : null,
      hasMore: list.length >= pageSize,
    };
  }

  private normalize(raw: ShopGoods): NormalizedGoods {
    // goods_key 是稳定的业务主键，优先用它。
    const externalId = String(raw.goods_key ?? raw.id ?? "");

    // 店铺接口的价格字段是 price，缺失时回落 real_price。
    const price = parsePrice(raw.price) ?? parsePrice(raw.real_price);

    // 公开接口通常不返回库存，只有个别情况带 extend.stock_count。
    const stock = parseStock(raw.extend?.stock_count);
    const goodsType = pickString(raw.goods_type) ?? "card";

    /*
     * status !== 1 表示已下架。
     *
     * 列表接口不返回 status（只有单品详情有），但能出现在公开店铺列表里
     * 本身就说明商品在售——下架商品不会展示给顾客。所以字段缺失时
     * 按 ACTIVE 处理是有依据的推断，不是瞎猜。
     */
    const statusValue =
      raw.status === undefined || raw.status === null
        ? null
        : Number(raw.status);
    const sourceStatus =
      statusValue === null
        ? SourceStatus.ACTIVE
        : statusValue === 1
          ? SourceStatus.ACTIVE
          : SourceStatus.INACTIVE;

    return {
      externalId,
      title: pickString(raw.name),
      description: pickString(raw.description),
      imageUrl: pickString(raw.cover, raw.image),
      price,
      stockCount: stock === undefined ? null : stock,
      sourceStatus,
      availabilityHint: this.hintFor(stock, sourceStatus),
      goodsType,
      url:
        pickString(raw.link) ??
        (raw.goods_key ? `${this.apiBase}/item/${raw.goods_key}` : null),
      raw,
    };
  }

  /**
   * 由 status 和库存推导展示状态。
   *
   * 库存只在**列表接口**里有（extend.stock_count），单品详情不返回。
   * 所以 fetchDetail 会去列表补一次，拿不到时走这里的兜底：
   *
   *   status !== 1        → 已下架
   *   有库存数字          → 按数字判断
   *   在售但库存拿不到     → NOT_APPLICABLE（前台显示"可查看"）
   *
   * 最后一种绝不能说成"有货"——那是在编造用户会当真的信息。
   */
  private hintFor(
    stock: number | null | undefined,
    sourceStatus: SourceStatus,
  ): Availability | null {
    if (sourceStatus === SourceStatus.INACTIVE) return Availability.OUT_OF_STOCK;
    if (sourceStatus === SourceStatus.UNKNOWN) return null;

    // 万一某些商品带了库存字段，就按真实值判断。
    if (stock !== undefined && stock !== null) {
      if (stock === 0) return Availability.OUT_OF_STOCK;
      return stock <= this.lowStockThreshold
        ? Availability.LOW_STOCK
        : Availability.IN_STOCK;
    }

    // 在售但拿不到库存 —— 如实表达为"可查看"，不谎称有货。
    return Availability.NOT_APPLICABLE;
  }
}

export function createLdxpShopConnector(
  credentials: ConnectorCredentials,
  options?: ConnectorRuntimeOptions,
): SourceConnector {
  return new LdxpShopConnector(credentials, options ?? {});
}
