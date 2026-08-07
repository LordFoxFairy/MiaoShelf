import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { prisma } from "@/lib/db";
import { listPublicProducts } from "@/lib/queries/public";
import { ProductCard } from "@/components/site/product-card";
import { EmptyState } from "@/components/admin/empty-state";
import { PackageSearch } from "lucide-react";
import { ProductFilters } from "@/components/site/product-filters";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug } });
  return { title: category?.name ?? "分类" };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const category = await prisma.category.findFirst({
    where: { slug, isVisible: true },
  });
  if (!category) notFound();

  const sort = asSort(query.sort);
  const inStockOnly = query.stock === "1";

  const products = await listPublicProducts({
    categorySlug: slug,
    inStockOnly,
    sort,
  });

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10 md:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {category.name}
        </h1>
        {category.description ? (
          <p className="max-w-2xl text-muted-foreground">
            {category.description}
          </p>
        ) : null}
      </header>

      <ProductFilters />

      {products.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="这个分类下还没有商品"
          description={
            inStockOnly ? "试试取消「只看有货」筛选。" : undefined
          }
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
