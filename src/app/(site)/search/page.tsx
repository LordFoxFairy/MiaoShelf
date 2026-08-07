import { PackageSearch } from "lucide-react";

import { listPublicProducts } from "@/lib/queries/public";
import { ProductCard } from "@/components/site/product-card";
import { ProductFilters } from "@/components/site/product-filters";
import { EmptyState } from "@/components/admin/empty-state";

export const metadata = { title: "全部商品" };
export const revalidate = 60;

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
