"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  ImageIcon,
  Package,
  RefreshCw,
  Sparkles,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { AdminProductRow } from "@/lib/queries/products";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/admin/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  autoTagAction,
  bulkCategoryAction,
  bulkTagAction,
  deleteProductsAction,
  refreshProductsAction,
  setPublicationAction,
} from "@/app/actions/products";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BulkTagDialog } from "@/components/admin/bulk-tag-dialog";

const PUBLICATION_STYLES: Record<string, { label: string; className: string }> =
  {
    PUBLISHED: { label: "已发布", className: "bg-state-ok-bg text-state-ok" },
    DRAFT: { label: "草稿", className: "bg-muted text-muted-foreground" },
    HIDDEN: {
      label: "已隐藏",
      className: "bg-state-unknown-bg text-state-unknown",
    },
  };

export function ProductsTable({
  products,
  categories,
}: {
  products: AdminProductRow[];
  categories: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  // 只保留当前列表里还存在的 —— 删除后或换筛选条件后，旧 ID 不该继续计数。
  const selectedIds = useMemo(() => {
    const visible = new Set(products.map((p) => p.id));
    return Array.from(selected).filter((id) => visible.has(id));
  }, [selected, products]);
  const allSelected =
    products.length > 0 && products.every((p) => selected.has(p.id));

  const clearSelected = () => setSelected(new Set());

  const run = (
    action: () => Promise<{ ok?: boolean; error?: string; message?: string }>,
    loading: string,
    clearSelection = true,
  ) => {
    startTransition(async () => {
      const id = toast.loading(loading);
      const result = await action();
      toast.dismiss(id);

      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message ?? "完成");
        // 只在需要清空勾选时才刷新页面。
        // router.refresh() 会重挂载组件、丢掉勾选，所以像"自动打标"
        // 这种希望接着操作的场景不刷新，等用户下一步动作时自然更新。
        if (clearSelection) {
          clearSelected();
          router.refresh();
        }
      }
    });
  };

  if (products.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="没有符合条件的商品"
        description="换个筛选条件，或从货源导入新商品。"
        action={
          <Link href="/admin/sources" className={buttonVariants({ size: "sm" })}>
            去导入货源
          </Link>
        }
      />
    );
  }

  return (
    <>
      {/* 选中后才出现操作条，平时不占地方 */}
      {selectedIds.length > 0 ? (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 border-b border-border/60 bg-card/95 px-4 py-2.5 backdrop-blur">
          <span className="text-sm font-medium">
            已选 {selectedIds.length} 个
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => setTagDialogOpen(true)}
            >
              <Tag className="size-3.5" />
              打标签
            </Button>

            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => autoTagAction(selectedIds), "正在识别标签…", false)
              }
            >
              <Sparkles className="size-3.5" />
              自动打标
            </Button>

            <select
              className="h-6 rounded-lg border border-border bg-card px-2 text-xs outline-none"
              defaultValue=""
              disabled={pending}
              onChange={(event) => {
                const value = event.target.value;
                event.target.value = "";
                run(
                  () =>
                    bulkCategoryAction(
                      selectedIds,
                      value === "__clear__" ? null : value,
                    ),
                  "正在设置分类…",
                );
              }}
            >
              <option value="" disabled>
                设置分类
              </option>
              <option value="__clear__">清除分类</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => setPublicationAction(selectedIds, "PUBLISHED"),
                  "正在发布…",
                )
              }
            >
              <Eye className="size-3.5" />
              发布
            </Button>

            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => setPublicationAction(selectedIds, "HIDDEN"),
                  "正在隐藏…",
                )
              }
            >
              <EyeOff className="size-3.5" />
              隐藏
            </Button>

            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => refreshProductsAction(selectedIds),
                  "正在提交刷新…",
                  false,
                )
              }
            >
              <RefreshCw className="size-3.5" />
              刷新
            </Button>

            <Button
              size="xs"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!confirm(`确定删除选中的 ${selectedIds.length} 个商品？`)) {
                  return;
                }
                run(() => deleteProductsAction(selectedIds), "正在删除…");
              }}
            >
              <Trash2 className="size-3.5" />
              删除
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(
                      allSelected
                        ? new Set()
                        : new Set(products.map((p) => p.id)),
                    )
                  }
                  className="size-4 rounded border-border accent-primary"
                  aria-label="全选"
                />
              </TableHead>
              <TableHead className="min-w-[260px]">商品</TableHead>
              <TableHead className="min-w-[100px]">本站状态</TableHead>
              <TableHead className="min-w-[170px]">货源状态</TableHead>
              <TableHead className="min-w-[110px] text-right">货源价</TableHead>
              <TableHead className="min-w-[110px] text-right">展示价</TableHead>
              <TableHead className="min-w-[90px]">分类</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {products.map((product) => {
              const pub = PUBLICATION_STYLES[product.publicationStatus] ?? {
                label: product.publicationStatus,
                className: "bg-muted text-muted-foreground",
              };

              return (
                <TableRow
                  key={product.id}
                  className={cn(selected.has(product.id) && "bg-accent/40")}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(product.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(product.id)) next.delete(product.id);
                          else next.add(product.id);
                          return next;
                        })
                      }
                      className="size-4 rounded border-border accent-primary"
                      aria-label={`选择 ${product.title}`}
                    />
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                        {product.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.coverUrl}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="size-4" />
                        )}
                      </span>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {product.featured ? (
                            <Star className="size-3.5 shrink-0 fill-state-low text-state-low" />
                          ) : null}
                          <Link
                            href={`/admin/products/${product.id}`}
                            className="truncate text-sm font-medium hover:text-primary hover:underline"
                          >
                            {product.title}
                          </Link>
                        </div>

                        {product.sourceName ? (
                          <p className="truncate text-xs text-muted-foreground">
                            来自 {product.sourceName}
                          </p>
                        ) : null}

                        {product.tags.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {product.tags.slice(0, 4).map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                            {product.tags.length > 4 ? (
                              <span className="text-[0.65rem] text-muted-foreground">
                                +{product.tags.length - 4}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                        pub.className,
                      )}
                    >
                      {pub.label}
                    </span>
                  </TableCell>

                  <TableCell>
                    {product.hasSource ? (
                      <div className="space-y-1">
                        <StatusBadge
                          state={product.displayState}
                          confirmedAt={product.confirmedAt}
                        />
                        {product.consecutiveFailures > 0 ? (
                          <p className="flex items-center gap-1 text-xs text-state-out">
                            <AlertTriangle className="size-3" />
                            连续失败 {product.consecutiveFailures} 次
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        手工商品
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {product.sourcePriceText ?? "—"}
                  </TableCell>

                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {product.displayPriceText ?? (
                      <span className="text-xs font-normal text-muted-foreground">
                        以外部页面为准
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {product.categoryName ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <BulkTagDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        count={selectedIds.length}
        onSubmit={(operation, tags) =>
          run(
            () => bulkTagAction(selectedIds, operation, tags),
            "正在更新标签…",
            false,
          )
        }
      />
    </>
  );
}
