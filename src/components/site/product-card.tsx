import Link from "next/link";
import { ImageIcon } from "lucide-react";

import type { PublicProductCard } from "@/lib/queries/public";
import { StatusBadge } from "@/components/status-badge";

/**
 * 前台商品卡。
 * 状态和确认时间必须一眼可见——这是本站相对于直接去小铺的价值所在。
 */
export function ProductCard({ product }: { product: PublicProductCard }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex aspect-[16/10] items-center justify-center bg-muted/60 text-muted-foreground">
        {product.coverUrl ? (
          // 外部图片域名不可控，用原生 img 避免 next/image 配置爆炸
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.coverUrl}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <ImageIcon className="size-8 opacity-40" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
            {product.title}
          </h3>
          {product.subtitle ? (
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {product.subtitle}
            </p>
          ) : null}
        </div>

        <div className="mt-auto space-y-2.5">
          <StatusBadge
            state={product.displayState}
            confirmedAt={product.confirmedAt}
          />

          <div className="flex items-end justify-between gap-2">
            {product.priceText ? (
              <span className="text-base font-semibold tabular-nums">
                {product.priceText}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                以外部页面为准
              </span>
            )}
            {product.categoryName ? (
              <span className="text-xs text-muted-foreground">
                {product.categoryName}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
