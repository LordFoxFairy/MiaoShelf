import { Suspense } from "react";
import { Plus } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/admin/page-header";
import { ProductsTable } from "@/components/admin/products-table";
import { ProductsToolbar } from "@/components/admin/products-toolbar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listAdminProducts, listAllTags } from "@/lib/queries/products";
import { prisma } from "@/lib/db";
import type { Availability, PublicationStatus } from "@/lib/enums";

export const metadata = { title: "商品管理" };
export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const asString = (value: string | string[] | undefined) =>
    typeof value === "string" && value ? value : undefined;

  // 标签用逗号分隔，多个是「且」关系。
  const tags = asString(params.tags)?.split(",").filter(Boolean) ?? [];

  const [products, allTags, categories, sources] = await Promise.all([
    listAdminProducts({
      q: asString(params.q),
      status: asString(params.status) as PublicationStatus | undefined,
      availability: asString(params.availability) as Availability | undefined,
      categoryId: asString(params.category),
      sourceAccountId: asString(params.source),
      tags,
    }),
    listAllTags(),
    prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.sourceAccount.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="商品管理"
        description="勾选商品可批量打标签、设分类、发布或删除。同步不会覆盖你的修改。"
        actions={
          <Link href="/admin/sources" className={buttonVariants({ size: "sm" })}>
            <Plus className="size-4" />
            导入货源商品
          </Link>
        }
      />

      <Suspense fallback={<Skeleton className="h-9 w-full max-w-2xl" />}>
        <ProductsToolbar
          tags={allTags}
          categories={categories}
          sources={sources}
        />
      </Suspense>

      <Card className="overflow-hidden py-0">
        <ProductsTable products={products} categories={categories} />
      </Card>

      <p className="text-xs text-muted-foreground">
        共 {products.length} 个商品
      </p>
    </>
  );
}
