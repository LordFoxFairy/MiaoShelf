import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { ProductEditor } from "@/components/admin/product-editor";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  computeFreshness,
  formatConfirmedAt,
  resolveDisplayState,
} from "@/lib/freshness";
import type { Availability, SourceStatus, SyncStatus } from "@/lib/enums";

export const dynamic = "force-dynamic";

export default async function ProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, categories] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        sourceProduct: {
          include: {
            statusHistory: { orderBy: { observedAt: "desc" }, take: 10 },
            sourceAccount: { select: { name: true } },
          },
        },
      },
    }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  if (!product) notFound();

  const source = product.sourceProduct;
  const now = new Date();

  const displayState = source
    ? resolveDisplayState({
        sourceStatus: source.sourceStatus as SourceStatus,
        availability: source.availability as Availability,
        syncStatus: source.syncStatus as SyncStatus,
        freshness: computeFreshness(
          { freshUntil: source.freshUntil, staleUntil: source.staleUntil },
          now,
        ),
        lastSuccessAt: source.lastSuccessAt,
      })
    : null;

  return (
    <>
      <PageHeader
        title={product.title}
        description={`slug: ${product.slug}`}
        actions={
          <>
            <Link
              href="/admin/products"
              className={buttonVariants({ size: "sm", variant: "ghost" })}
            >
              <ArrowLeft className="size-4" />
              返回
            </Link>
            {product.publicationStatus === "PUBLISHED" ? (
              <Link
                href={`/products/${product.slug}`}
                target="_blank"
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                查看前台
                <ExternalLink className="size-4" />
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ProductEditor
          product={{
            id: product.id,
            title: product.title,
            subtitle: product.subtitle,
            description: product.description,
            coverUrl: product.coverUrl,
            buttonText: product.buttonText,
            priceMode: product.priceMode,
            priceAdjustment: product.priceAdjustment
              ? String(product.priceAdjustment)
              : null,
            categoryId: product.categoryId,
            targetUrlOverride: product.targetUrlOverride,
            seoTitle: product.seoTitle,
            seoDescription: product.seoDescription,
            sortOrder: product.sortOrder,
            featured: product.featured,
            autoHideWhenOutOfStock: product.autoHideWhenOutOfStock,
            publicationStatus: product.publicationStatus,
            hasSource: source !== null,
          }}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        />

        <aside className="space-y-4">
          {source ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">货源状态</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {displayState ? (
                  <StatusBadge
                    state={displayState}
                    confirmedAt={formatConfirmedAt(source.lastSuccessAt, now)}
                  />
                ) : null}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <Field label="货源账号" value={source.sourceAccount.name} />
                  <Field label="外部 ID" value={source.externalId} />
                  <Field
                    label="货源价"
                    value={
                      source.sourcePrice ? `¥${source.sourcePrice}` : "—"
                    }
                  />
                  <Field
                    label="库存"
                    value={
                      source.stockCount === null
                        ? "无需库存"
                        : String(source.stockCount)
                    }
                  />
                  <Field label="同步状态" value={source.syncStatus} />
                  <Field
                    label="连续失败"
                    value={String(source.consecutiveFailures)}
                  />
                </dl>

                {source.lastError ? (
                  <p className="rounded-lg bg-state-out-bg px-3 py-2 text-xs text-state-out">
                    {source.lastError}
                  </p>
                ) : null}

                {source.sourceUrl ? (
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    打开外部商品页
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-5 text-sm text-muted-foreground">
                这是一个手工商品，没有绑定货源，不会自动同步。
              </CardContent>
            </Card>
          )}

          {source && source.statusHistory.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">变化历史</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5 text-xs">
                  {source.statusHistory.map((h) => (
                    <li key={h.id} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        {h.oldAvailability !== h.newAvailability
                          ? `${h.oldAvailability} → ${h.newAvailability}`
                          : h.oldPrice !== h.newPrice
                            ? `¥${h.oldPrice ?? "—"} → ¥${h.newPrice ?? "—"}`
                            : `库存 ${h.oldStockCount ?? "—"} → ${h.newStockCount ?? "—"}`}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {new Date(h.observedAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
