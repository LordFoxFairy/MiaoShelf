import { PackageSearch } from "lucide-react";

import { listPublicProducts } from "@/lib/queries/public";
import { ProductCard } from "@/components/site/product-card";
import { ProductFilters } from "@/components/site/product-filters";
import { EmptyState } from "@/components/admin/empty-state";

export const metadata = { title: "全部商品" };
/**
 * 按需渲染而不是构建时预渲染 —— 这些页面要读数据库，
 * 构建环境（比如 Docker 镜像构建）里没有数据库。
 * 缓存改由 CDN 按响应头处理（见下方 Cache-Control）。
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim() : undefined;
  const inStockOnly = query.stock === "1";

  const products = await listPublicProducts({
    q,
    inStockOnly,
    sort: asSort(query.sort),
    take: 100,
  });

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10 md:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {q ? `搜索「${q}」` : "全部商品"}
        </h1>
        <p className="text-sm text-muted-foreground">
          共 {products.length} 个商品
        </p>
      </header>

      <ProductFilters />

      {products.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={q ? "没有找到匹配的商品" : "还没有上架商品"}
          description={q ? "换个关键词试试。" : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      )}
    </main>
  );
}

function asSort(
  value: string | string[] | undefined,
): "featured" | "latest" | "price_asc" | "price_desc" {
  const allowed = ["featured", "latest", "price_asc", "price_desc"] as const;
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as (typeof allowed)[number])
    : "featured";
}
