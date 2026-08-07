"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TagCount } from "@/lib/tags";

/**
 * 商品列表工具栏。
 *
 * 筛选状态放在 URL 里而不是组件 state：刷新、分享链接、浏览器后退
 * 都能保持筛选条件，服务端也能直接按参数查询。
 */
const STATUS_TABS = [
  { value: "", label: "全部" },
  { value: "PUBLISHED", label: "已发布" },
  { value: "DRAFT", label: "草稿" },
  { value: "HIDDEN", label: "已隐藏" },
] as const;

const AVAILABILITY_TABS = [
  { value: "", label: "全部库存" },
  { value: "IN_STOCK", label: "有货" },
  { value: "LOW_STOCK", label: "紧张" },
  { value: "OUT_OF_STOCK", label: "缺货" },
] as const;

export function ProductsToolbar({
  tags,
  categories,
  sources,
}: {
  tags: TagCount[];
  categories: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);

    startTransition(() => {
      router.replace(`/admin/products?${next.toString()}`);
    });
  };

  const activeTags = (params.get("tags") ?? "").split(",").filter(Boolean);

  const toggleTag = (tag: string) => {
    const next = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag];
    setParam("tags", next.join(","));
  };

  const hasFilters =
    activeTags.length > 0 ||
    Boolean(params.get("q")) ||
    Boolean(params.get("status")) ||
    Boolean(params.get("availability")) ||
    Boolean(params.get("category")) ||
    Boolean(params.get("source"));

  return (
    <div
      className={cn(
        "space-y-3 transition-opacity",
        isPending && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            defaultValue={params.get("q") ?? ""}
            placeholder="搜索商品标题…"
            className="h-9 pl-9"
            onChange={(event) => setParam("q", event.target.value.trim())}
          />
        </div>

        <SegmentedTabs
          options={STATUS_TABS}
          value={params.get("status") ?? ""}
          onChange={(value) => setParam("status", value)}
        />

        <SegmentedTabs
          options={AVAILABILITY_TABS}
          value={params.get("availability") ?? ""}
          onChange={(value) => setParam("availability", value)}
        />

        {categories.length > 0 ? (
          <select
            value={params.get("category") ?? ""}
            onChange={(event) => setParam("category", event.target.value)}
            className="h-9 rounded-xl border border-border bg-card px-3 text-xs outline-none focus:border-ring"
          >
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        ) : null}

        {/* 接了多个店铺后，按来源筛选能快速定位「这批是从哪进的」 */}
        {sources.length > 1 ? (
          <select
            value={params.get("source") ?? ""}
            onChange={(event) => setParam("source", event.target.value)}
            className="h-9 rounded-xl border border-border bg-card px-3 text-xs outline-none focus:border-ring"
          >
            <option value="">全部货源</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        ) : null}

        {hasFilters ? (
          <button
            type="button"
            onClick={() => startTransition(() => router.replace("/admin/products"))}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
            清除筛选
          </button>
        ) : null}
      </div>

      {/* 标签是「且」关系：多选就是同时满足 */}
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">标签</span>
          {tags.slice(0, 24).map(({ tag, count }) => {
            const active = activeTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-primary/40 bg-accent font-medium text-accent-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {tag}
                <span className="text-[0.65rem] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 胶囊形分段控件 —— 比下拉菜单少一次点击，选项少时更好用。 */
function SegmentedTabs({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-muted/60 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
