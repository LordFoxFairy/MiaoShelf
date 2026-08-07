"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import type { BrowseRow } from "@/app/admin/sources/[id]/page";
import { importGoodsAction } from "@/app/actions/products";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/empty-state";

const GOODS_TYPES = [
  { value: "card", label: "卡密" },
  { value: "article", label: "知识" },
  { value: "resource", label: "资源" },
  { value: "equity", label: "权益" },
] as const;

export function SourceBrowser({
  accountId,
  rows,
  tab,
  keywords,
  goodsType,
  page,
  hasMore,
}: {
  accountId: string;
  rows: BrowseRow[];
  tab: "plaza" | "mine";
  keywords: string;
  goodsType: string;
  page: number;
  hasMore: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, startImport] = useTransition();

  const navigate = (patch: Record<string, string | number>) => {
    const params = new URLSearchParams({
      tab,
      q: keywords,
      type: goodsType,
      page: String(page),
    });
    for (const [key, value] of Object.entries(patch)) {
      params.set(key, String(value));
    }
    router.push(`/admin/sources/${accountId}?${params.toString()}`);
  };

  const toggle = (externalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  // 已导入的不参与全选，避免重复操作。
  const selectable = rows.filter((r) => !r.imported);
  const allSelected =
    selectable.length > 0 && selectable.every((r) => selected.has(r.externalId));

  const doImport = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    startImport(async () => {
      const toastId = toast.loading(`正在导入 ${ids.length} 个商品…`);
      const result = await importGoodsAction(accountId, ids);
      toast.dismiss(toastId);

      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message ?? "导入完成");
        setSelected(new Set());
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-0.5 rounded-xl bg-muted/60 p-1">
          <TabButton
            active={tab === "plaza"}
            onClick={() => navigate({ tab: "plaza", page: 1 })}
          >
            货源广场
          </TabButton>
          <TabButton
            active={tab === "mine"}
            onClick={() => navigate({ tab: "mine", page: 1 })}
          >
            我的商品
          </TabButton>
        </div>

        {tab === "plaza" ? (
          <form
            className="relative min-w-[220px] flex-1 sm:max-w-xs"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("q");
              navigate({ q: String(value ?? ""), page: 1 });
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={keywords}
              placeholder="搜索货源关键词…"
              className="h-9 pl-9"
            />
          </form>
        ) : null}

        <div className="inline-flex items-center gap-0.5 rounded-xl bg-muted/60 p-1">
          {GOODS_TYPES.map((type) => (
            <TabButton
              key={type.value}
              active={goodsType === type.value}
              onClick={() => navigate({ type: type.value, page: 1 })}
            >
              {type.label}
            </TabButton>
          ))}
        </div>

        {selected.size > 0 ? (
          <Button
            size="sm"
            className="ml-auto"
            disabled={importing}
            onClick={doImport}
          >
            {importing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            导入选中 {selected.size} 个
          </Button>
        ) : null}
      </div>

      <Card className="overflow-hidden py-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={Search}
            title={tab === "plaza" ? "没有搜到货源" : "小铺里还没有商品"}
            description={
              tab === "plaza"
                ? "换个关键词，或确认账号会话是否有效。"
                : undefined
            }
          />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelected(
                    allSelected
                      ? new Set()
                      : new Set(selectable.map((r) => r.externalId)),
                  )
                }
                className="size-4 rounded border-border accent-primary"
                aria-label="全选"
              />
              <span className="text-xs text-muted-foreground">
                全选未导入的 {selectable.length} 个
              </span>
            </div>

            <ul className="divide-y divide-border/60">
              {rows.map((row) => (
                <li
                  key={row.externalId}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-4 py-3",
                    row.imported && "bg-muted/30",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(row.externalId)}
                    disabled={row.imported}
                    onChange={() => toggle(row.externalId)}
                    className="size-4 shrink-0 rounded border-border accent-primary disabled:opacity-40"
                    aria-label={`选择 ${row.title}`}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    <p className="text-xs text-muted-foreground">
                      ID {row.externalId}
                      {row.goodsType ? ` · ${row.goodsType}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-4 text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {row.stockCount === null
                        ? "无需库存"
                        : `库存 ${row.stockCount}`}
                    </span>
                    <span className="w-16 text-right font-medium tabular-nums">
                      {row.priceText ?? "—"}
                    </span>

                    {row.imported ? (
                      <span className="rounded-full bg-state-ok-bg px-2.5 py-1 font-medium text-state-ok">
                        已导入
                      </span>
                    ) : row.connected ? (
                      <span className="rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground">
                        已对接
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                        未导入
                      </span>
                    )}

                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground transition-colors hover:text-primary"
                        aria-label="打开外部页面"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => navigate({ page: page - 1 })}
        >
          上一页
        </Button>
        <span className="text-xs text-muted-foreground">第 {page} 页</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!hasMore}
          onClick={() => navigate({ page: page + 1 })}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
