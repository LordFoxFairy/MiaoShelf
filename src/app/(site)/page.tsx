import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";

import { listPublicCategories, listPublicProducts } from "@/lib/queries/public";
import { ProductCard } from "@/components/site/product-card";
import { EmptyState } from "@/components/admin/empty-state";

/**
 * 按需渲染而不是构建时预渲染 —— 这些页面要读数据库，
 * 构建环境（比如 Docker 镜像构建）里没有数据库。
 * 缓存改由 CDN 按响应头处理（见下方 Cache-Control）。
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export default async function HomePage() {
  const [featured, latest, categories] = await Promise.all([
    listPublicProducts({ sort: "featured", take: 8 }),
    listPublicProducts({ sort: "latest", take: 8 }),
    listPublicCategories(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-14 px-4 py-12 md:px-6">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          发现商品，查看实时状态
        </h1>
        <p className="max-w-xl text-muted-foreground">
          我们持续同步商品的价格与库存，并在你点击前再次确认，
          尽量避免你打开一个已经买不到的页面。
        </p>

        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-2">
            {categories.map((category) => (
              <Link
                key={category.slug}
                href={`/category/${category.slug}`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm transition-colors hover:border-primary/40 hover:text-primary"
              >
                {category.name}
                <span className="text-xs text-muted-foreground">
                  {category.productCount}
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {featured.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="还没有上架商品"
          description="在管理后台导入货源、编辑内容并发布后，商品会出现在这里。"
        />
      ) : (
        <>
          <ProductSection title="推荐商品" products={featured} />
          <ProductSection
            title="最新上架"
            products={latest}
            href="/search"
            hrefLabel="查看全部"
          />
        </>
      )}
    </main>
  );
}

function ProductSection({
  title,
  products,
  href,
  hrefLabel,
}: {
  title: string;
  products: Awaited<ReturnType<typeof listPublicProducts>>;
  href?: string;
  hrefLabel?: string;
}) {
  if (products.length === 0) return null;

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            {hrefLabel}
            <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.slug} product={product} />
        ))}
      </div>
    </section>
  );
}
