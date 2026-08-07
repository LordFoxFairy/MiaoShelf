"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** 前台筛选。条件放 URL 里，方便分享和后退。 */
const SORTS = [
  { value: "featured", label: "推荐" },
  { value: "latest", label: "最新" },
  { value: "price_asc", label: "价格从低到高" },
  { value: "price_desc", label: "价格从高到低" },
] as const;

export function ProductFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const currentSort = params.get("sort") ?? "featured";
  const inStockOnly = params.get("stock") === "1";

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center gap-0.5 rounded-xl bg-muted/60 p-1">
        {SORTS.map((sort) => (
          <button
            key={sort.value}
            type="button"
            onClick={() => setParam("sort", sort.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              currentSort === sort.value
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {sort.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setParam("stock", inStockOnly ? null : "1")}
        className={cn(
          "rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
          inStockOnly
            ? "border-primary/40 bg-accent text-accent-foreground"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        只看有货
      </button>
    </div>
  );
}
