import { prisma } from "@/lib/db";
import Decimal from "decimal.js";
import {
  computeFreshness,
  formatConfirmedAt,
  resolveDisplayState,
  type DisplayState,
} from "@/lib/freshness";
import { computeDisplayPrice, formatPrice } from "@/lib/pricing";
import { countTags, parseTags, type TagCount } from "@/lib/tags";
import type {
  Availability,
  PriceMode,
  PublicationStatus,
  SourceStatus,
  SyncStatus,
} from "@/lib/enums";

/**
 * 商品列表查询（spec §17.4）。
 *
 * 展示状态在服务端算好再传给组件：状态判断逻辑只有一份，
 * 后台和前台都用同一套规则，不会出现两边显示不一致。
 */
export interface AdminProductRow {
  id: string;
  slug: string;
  title: string;
  sourceTitle: string | null;
  coverUrl: string | null;
  publicationStatus: PublicationStatus;
  categoryName: string | null;
  sortOrder: number;
  featured: boolean;
  /** 货源价与展示价，已格式化。 */
  sourcePriceText: string | null;
  displayPriceText: string | null;
  /** 前台会看到的状态。 */
  displayState: DisplayState;
  confirmedAt: string | null;
  /** 同步健康度。 */
  syncStatus: SyncStatus | null;
  consecutiveFailures: number;
  lastError: string | null;
  hasSource: boolean;
  tags: string[];
  categoryId: string | null;
  /** 来自哪个店铺。多货源时用来区分同款商品。 */
  sourceName: string | null;
  sourceAccountId: string | null;
}

export interface AdminProductFilters {
  q?: string;
  status?: PublicationStatus;
  availability?: Availability;
  /** 标签筛选，多个标签是「且」关系。 */
  tags?: string[];
  categoryId?: string;
  /** 按货源店铺筛选。 */
  sourceAccountId?: string;
}

export async function listAdminProducts(
  filters: AdminProductFilters = {},
): Promise<AdminProductRow[]> {
  const products = await prisma.product.findMany({
    where: {
      ...(filters.status ? { publicationStatus: filters.status } : {}),
      ...(filters.q
        ? { title: { contains: filters.q } }
        : {}),
      ...(filters.availability
        ? { sourceProduct: { availability: filters.availability } }
        : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.sourceAccountId
        ? { sourceProduct: { sourceAccountId: filters.sourceAccountId } }
        : {}),
    },
    include: {
      sourceProduct: { include: { sourceAccount: { select: { name: true } } } },
      category: { select: { name: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    // 标签在库里是 JSON 字符串，SQLite 没法直接查，
    // 所以多取一些再在内存里过滤。商品量到万级时要改成关联表。
    take: filters.tags?.length ? 1000 : 200,
  });

  const now = new Date();

  const rows: AdminProductRow[] = products.map((product) => {
    const source = product.sourceProduct;

    const freshness = computeFreshness(
      {
        freshUntil: source?.freshUntil ?? null,
        staleUntil: source?.staleUntil ?? null,
      },
      now,
    );

    const displayState = resolveDisplayState({
      sourceStatus: (source?.sourceStatus ?? "UNKNOWN") as SourceStatus,
      availability: (source?.availability ?? "UNKNOWN") as Availability,
      syncStatus: (source?.syncStatus ?? "STALE") as SyncStatus,
      freshness,
      lastSuccessAt: source?.lastSuccessAt ?? null,
    });

    const sourcePrice = source?.sourcePrice
      ? new Decimal(source.sourcePrice.toString())
      : null;

    const displayPrice = computeDisplayPrice({
      mode: product.priceMode as PriceMode,
      sourcePrice,
      adjustment: product.priceAdjustment
        ? new Decimal(product.priceAdjustment.toString())
        : null,
    });

    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      sourceTitle: source?.sourceTitle ?? null,
      coverUrl: product.coverUrl,
      publicationStatus: product.publicationStatus as PublicationStatus,
      categoryName: product.category?.name ?? null,
      sortOrder: product.sortOrder,
      featured: product.featured,
      sourcePriceText: formatPrice(sourcePrice),
      displayPriceText: formatPrice(displayPrice),
      displayState,
      confirmedAt: formatConfirmedAt(source?.lastSuccessAt ?? null, now),
      syncStatus: (source?.syncStatus ?? null) as SyncStatus | null,
      consecutiveFailures: source?.consecutiveFailures ?? 0,
      lastError: source?.lastError ?? null,
      hasSource: source !== null,
      tags: parseTags(product.tags),
      categoryId: product.categoryId,
      sourceName: source?.sourceAccount.name ?? null,
      sourceAccountId: source?.sourceAccountId ?? null,
    };
  });

  // 标签是「且」关系：选了「质保」+「美区」就只看同时满足的。
  if (filters.tags?.length) {
    const required = filters.tags;
    return rows.filter((row) =>
      required.every((tag) => row.tags.includes(tag)),
    );
  }

  return rows;
}

/** 全部标签及使用次数，供筛选器展示。 */
export async function listAllTags(): Promise<TagCount[]> {
  const products = await prisma.product.findMany({ select: { tags: true } });
  return countTags(products.map((p) => parseTags(p.tags)));
}
