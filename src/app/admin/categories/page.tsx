import { Tags } from "lucide-react";

import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { Card } from "@/components/ui/card";
import { CategoryManager } from "@/components/admin/category-manager";

export const metadata = { title: "分类" };
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      _count: { select: { products: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="分类"
        description="分类用于前台导航和商品筛选。"
        actions={<CategoryManager mode="create" />}
      />

      <Card className="overflow-hidden py-0">
        {categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="还没有分类"
            description="创建分类后，可以在商品编辑页把商品归类。"
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {categories.map((category) => (
              <li
                key={category.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {category.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    /category/{category.slug}
                  </p>
                </div>

                <span className="text-xs tabular-nums text-muted-foreground">
                  {category._count.products} 个商品
                </span>

                {!category.isVisible ? (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    已隐藏
                  </span>
                ) : null}

                <CategoryManager
                  mode="edit"
                  category={{
                    id: category.id,
                    name: category.name,
                    slug: category.slug,
                    description: category.description,
                    sortOrder: category.sortOrder,
                    isVisible: category.isVisible,
                    productCount: category._count.products,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
