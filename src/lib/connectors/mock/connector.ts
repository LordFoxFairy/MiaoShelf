import Decimal from "decimal.js";
import { Availability, SourceStatus } from "@/lib/enums";
import {
  ConnectorError,
  type ConnectorCredentials,
  type NormalizedGoods,
  type NormalizedPage,
  type ResolvedLink,
  type SearchCriteria,
  type SessionCheck,
  type SourceConnector,
} from "@/lib/connectors/types";

/**
 * 演示用连接器。
 *
 * 存在的意义：没有真实小铺账号时，整条链路（搜索 → 导入 → 编辑 →
 * 发布 → 展示 → 跳转 → 同步）依然能完整跑通和演示。
 * 也是 CI 里跑测试的默认实现——CI 绝不能碰真实外部接口。
 */

const CATALOG: Array<{
  id: string;
  name: string;
  price: string;
  stock: number | null;
  status: SourceStatus;
  type: string;
}> = [
  { id: "mock-2001", name: "ChatGPT Plus 会员 1 个月", price: "128.00", stock: 42, status: SourceStatus.ACTIVE, type: "card" },
  { id: "mock-2002", name: "Claude Pro 会员 1 个月", price: "145.00", stock: 3, status: SourceStatus.ACTIVE, type: "card" },
  { id: "mock-2003", name: "Midjourney 标准订阅", price: "220.00", stock: 0, status: SourceStatus.ACTIVE, type: "card" },
  { id: "mock-2004", name: "Netflix 高级会员", price: "88.00", stock: 12, status: SourceStatus.ACTIVE, type: "card" },
  { id: "mock-2005", name: "Spotify 家庭组", price: "45.00", stock: null, status: SourceStatus.ACTIVE, type: "equity" },
  { id: "mock-2006", name: "YouTube Premium 年卡", price: "268.00", stock: 8, status: SourceStatus.ACTIVE, type: "card" },
  { id: "mock-2007", name: "Adobe 全家桶 1 年", price: "399.00", stock: 5, status: SourceStatus.ACTIVE, type: "card" },
  { id: "mock-2008", name: "Notion Plus 年付", price: "180.00", stock: 0, status: SourceStatus.INACTIVE, type: "card" },
  { id: "mock-2009", name: "Figma 专业版", price: "320.00", stock: 15, status: SourceStatus.ACTIVE, type: "card" },
  { id: "mock-2010", name: "GitHub Copilot 年费", price: "148.00", stock: 30, status: SourceStatus.ACTIVE, type: "card" },
];

export class MockConnector implements SourceConnector {
  readonly provider = "MOCK" as const;

  private readonly lowStockThreshold: number;

  constructor(_credentials: ConnectorCredentials, lowStockThreshold = 5) {
    this.lowStockThreshold = lowStockThreshold;
  }

  async verifySession(): Promise<SessionCheck> {
    return { valid: true, needsVerification: false };
  }

  async search(
    criteria: SearchCriteria,
  ): Promise<NormalizedPage<NormalizedGoods>> {
    const keyword = criteria.keywords?.trim().toLowerCase();
    const filtered = keyword
      ? CATALOG.filter((item) => item.name.toLowerCase().includes(keyword))
      : CATALOG;

    const start = (criteria.page - 1) * criteria.pageSize;
    const slice = filtered.slice(start, start + criteria.pageSize);

    return {
      items: slice.map((item) => this.toNormalized(item)),
      page: criteria.page,
      pageSize: criteria.pageSize,
      total: filtered.length,
      hasMore: start + criteria.pageSize < filtered.length,
    };
  }

  async listAll(
    criteria: Omit<SearchCriteria, "keywords">,
  ): Promise<NormalizedPage<NormalizedGoods>> {
    return this.search({ ...criteria, keywords: undefined });
  }

  async fetchDetail(externalId: string): Promise<NormalizedGoods> {
    const item = CATALOG.find((c) => c.id === externalId);
    if (!item) {
      throw new ConnectorError("UNKNOWN", `商品不存在：${externalId}`);
    }
    return this.toNormalized(item);
  }

  async resolveLink(externalId: string): Promise<ResolvedLink> {
    return {
      url: `https://www.ldxp.cn/goods/${externalId}`,
      shortUrl: null,
    };
  }

  private toNormalized(item: (typeof CATALOG)[number]): NormalizedGoods {
    return {
      externalId: item.id,
      title: item.name,
      description: `${item.name} —— 演示数据，非真实商品。`,
      imageUrl: null,
      price: new Decimal(item.price),
      stockCount: item.stock,
      sourceStatus: item.status,
      availabilityHint:
        item.stock === null
          ? Availability.NOT_APPLICABLE
          : item.stock === 0
            ? Availability.OUT_OF_STOCK
            : item.stock <= this.lowStockThreshold
              ? Availability.LOW_STOCK
              : Availability.IN_STOCK,
      goodsType: item.type,
      url: `https://www.ldxp.cn/goods/${item.id}`,
      raw: item,
    };
  }
}

export function createMockConnector(
  credentials: ConnectorCredentials,
): SourceConnector {
  return new MockConnector(credentials);
}
