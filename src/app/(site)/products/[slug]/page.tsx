import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink, ImageIcon, ShieldCheck } from "lucide-react";

import { getPublicProduct } from "@/lib/queries/public";
import { LiveStatus } from "@/components/site/live-status";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 商品详情。页面主体可被 CDN 短缓存，库存状态由 LiveStatus 单独实时拉取——
 * 否则整页缓存会让库存显示成几分钟前的（spec §13.6）。
 *
 * 以下
 * 按需渲染而不是构建时预渲染 —— 这些页面要读数据库，
 * 构建环境（比如 Docker 镜像构建）里没有数据库。
 * 缓存改由 CDN 按响应头处理（见下方 Cache-Control）。
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublicProduct(slug);
  if (!product) return { title: "商品不存在" };

  return {
    title: product.seoTitle ?? product.title,
    description:
      product.seoDescription ?? product.subtitle ?? undefined,
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getPublicProduct(slug);
  if (!product) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 md:px-6">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        {product.categorySlug ? (
          <>
            <span>/</span>
            <Link
              href={`/category/${product.categorySlug}`}
              className="hover:text-foreground"
            >
              {product.categoryName}
            </Link>
          </>
        ) : null}
      </nav>

      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/60 text-muted-foreground">
            {product.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.coverUrl}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <ImageIcon className="size-10 opacity-40" />
            )}
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {product.title}
            </h1>
            {product.subtitle ? (
              <p className="text-muted-foreground">{product.subtitle}</p>
            ) : null}
          </div>

          {product.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {product.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          {product.description ? (
            <div className="space-y-2 border-t border-border/60 pt-6">
              <h2 className="text-sm font-medium">商品介绍</h2>
              {/*
                外部描述可能含 HTML，这里按纯文本渲染。
                绝不用 dangerouslySetInnerHTML —— 那是储存型 XSS 的入口（spec §22）。
              */}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {product.description}
              </p>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div>
              {product.priceText ? (
                <p className="text-2xl font-semibold tabular-nums">
                  {product.priceText}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  价格以外部页面为准
                </p>
              )}
            </div>

            {/* 状态实时拉取，不吃页面缓存 */}
            <LiveStatus
              slug={product.slug}
              initialState={product.displayState}
              initialConfirmedAt={product.confirmedAt}
              needsRefresh={product.needsRefresh}
            />

            <Link
              href={`/go/${product.slug}`}
              className={cn(buttonVariants({ size: "lg" }), "w-full")}
            >
              {product.buttonText}
              <ExternalLink className="size-4" />
            </Link>

            <p className="text-xs leading-relaxed text-muted-foreground">
              点击后将前往第三方商品页面，购买、付款、交付及售后由对应页面完成。
            </p>
          </div>

          <div className="flex gap-2.5 rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-state-ok" />
            <p>
              我们会在你点击时再次确认商品状态。
              若确认为缺货，会阻止跳转以免你白跑一趟。
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
