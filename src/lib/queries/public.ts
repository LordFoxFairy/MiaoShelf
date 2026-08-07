import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import {
  computeFreshness,
  formatConfirmedAt,
  resolveDisplayState,
  type DisplayState,
} from "@/lib/freshness";
import { computeDisplayPrice, formatPrice } from "@/lib/pricing";
import type {
  Availability,
  PriceMode,
  SourceStatus,
  SyncStatus,
} from "@/lib/enums";

/**
 * 前台查询（spec §19）。
 *
 * 只返回已发布商品，且绝不返回账号、Cookie、Token 或原始私有响应。
 */

export interface PublicProductCard {
  slug: string;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  priceText: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  displayState: DisplayState;
  confirmedAt: string | null;
  featured: boolean;
}

export interface PublicProductDetail extends PublicProductCard {
  id: string;
  description: string | null;
  gallery: string[];
  tags: string[];
  buttonText: string;
  seoTitle: string | null;
  seoDescription: string | null;
  stockCount: number | null;
  /** 供前端短轮询判断要不要继续问。 */
  needsRefresh: boolean;
}

type ProductWithRelations = Awaited<
  ReturnType<typeof prisma.product.findFirst>
> & {
  sourceProduct?: {
    sourceStatus: string;
    availability: string;
    syncStatus: string;
    stockCount: number | null;
    sourcePrice: unknown;
    lastSuccessAt: Date | null;
    freshUntil: Date | null;
    staleUntil: Date | null;
  } | null;
  category?: { name: string; slug: string } | null;
};

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toCard(
  product: NonNullable<ProductWithRelations>,
  now: Date,
): PublicProductCard {
  const source = product.sourceProduct ?? null;

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
    ? new Decimal(String(source.sourcePrice))
    : null;

  const displayPrice = computeDisplayPrice({
    mode: product.priceMode as PriceMode,
    sourcePrice,
    adjustment: product.priceAdjustment
      ? new Decimal(String(product.priceAdjustment))
      : null,
  });

  return {
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    coverUrl: product.coverUrl,
    priceText: formatPrice(displayPrice),
    categoryName: product.category?.name ?? null,
    categorySlug: product.category?.slug ?? null,
    displayState,
    confirmedAt: formatConfirmedAt(source?.lastSuccessAt ?? null, now),
    featured: product.featured,
  };
}

const PUBLIC_INCLUDE = {
  sourceProduct: {
    select: {
      sourceStatus: true,
      availability: true,
      syncStatus: true,
      stockCount: true,
      sourcePrice: true,
      lastSuccessAt: true,
      freshUntil: true,
      staleUntil: true,
    },
  },
  category: { select: { name: true, slug: true } },
} as const;

export interface PublicListOptions {
  q?: string;
  categorySlug?: string;
  inStockOnly?: boolean;
  sort?: "featured" | "latest" | "price_asc" | "price_desc";
  take?: number;
}

export async function listPublicProducts(
  options: PublicListOptions = {},
): Promise<PublicProductCard[]> {
  const { q, categorySlug, inStockOnly, sort = "featured", take = 60 } = options;

  const products = await prisma.product.findMany({
    where: {
      publicationStatus: "PUBLISHED",
      ...(q ? { title: { contains: q } } : {}),
      ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      ...(inStockOnly
        ? {
            sourceProduct: {
              availability: { in: ["IN_STOCK", "LOW_STOCK", "NOT_APPLICABLE"] },
            },
          }
        : {}),
    },
    include: PUBLIC_INCLUDE,
    orderBy:
      sort === "latest"
        ? [{ publishedAt: "desc" }]
        : sort === "price_asc"
          ? [{ displayPrice: "asc" }]
          : sort === "price_desc"
            ? [{ displayPrice: "desc" }]
            : [{ featured: "desc" }, { sortOrder: "asc" }],
    take,
  });

  const now = new Date();
  return products.map((p) => toCard(p as NonNullable<ProductWithRelations>, now));
}

export async function getPublicProduct(
  slug: string,
): Promise<PublicProductDetail | null> {
  const product = await prisma.product.findFirst({
    where: { slug, publicationStatus: "PUBLISHED" },
    include: PUBLIC_INCLUDE,
  });
  if (!product) return null;

  const now = new Date();
  const typed = product as NonNullable<ProductWithRelations>;
  const card = toCard(typed, now);
  const source = typed.sourceProduct ?? null;

  const freshness = computeFreshness(
    {
      freshUntil: source?.freshUntil ?? null,
      staleUntil: source?.staleUntil ?? null,
    },
    now,
  );

  return {
    ...card,
    id: product.id,
    description: product.description,
    gallery: parseJsonArray(product.gallery),
    tags: parseJsonArray(product.tags),
    buttonText: product.buttonText,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    stockCount: source?.stockCount ?? null,
    // 过期就该在后台刷新一次，前端据此决定要不要轮询。
    needsRefresh: freshness !== "FRESH" && source !== null,
  };
}

export interface PublicCategory {
  name: string;
  slug: string;
  description: string | null;
  productCount: number;
}

export async function listPublicCategories(): Promise<PublicCategory[]> {
  const categories = await prisma.category.findMany({
    where: { isVisible: true },
    orderBy: { sortOrder: "asc" },
    include: {
      _count: {
        select: { products: { where: { publicationStatus: "PUBLISHED" } } },
      },
    },
  });

  return categories.map((c) => ({
    name: c.name,
    slug: c.slug,
    description: c.description,
    productCount: c._count.products,
  }));
}
