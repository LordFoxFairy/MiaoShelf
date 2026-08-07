import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ExternalLink, PackageX } from "lucide-react";

import { prisma } from "@/lib/db";
import { resolveProductClick } from "@/lib/sync/resolve";
import { checkRateLimit } from "@/lib/cache";
import {
  extractClientContext,
  hashWithSalt,
} from "@/lib/request-context";
import { deriveHashSalt } from "@/lib/crypto";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatConfirmedAt } from "@/lib/freshness";
import type { Availability } from "@/lib/enums";

/**
 * 点击跳转（spec §15）。
 *
 * 只接受内部 slug，目标地址一律从数据库读 —— 绝不接受 ?url= 参数，
 * 那就是开放重定向。
 */
export const dynamic = "force-dynamic";

export default async function GoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const headerList = await headers();

  const proxyMode =
    (process.env.TRUSTED_PROXY_MODE as "cloudflare" | "xff" | "none") ?? "none";
  const client = extractClientContext(headerList, proxyMode);

  // 限流：同一 IP + 商品 5 秒一次（spec §15.4）
  const rateKey = `${client.ip ?? "unknown"}:${slug}`;
  const limit = await checkRateLimit("resolve", rateKey, 1, 5);
  if (!limit.allowed) {
    return (
      <Interstitial
        icon={<AlertTriangle className="size-6 text-state-low" />}
        title="操作过于频繁"
        message={`请 ${limit.resetSeconds} 秒后再试。`}
        slug={slug}
      />
    );
  }

  const allowedHosts = (process.env.LDXP_ALLOWED_REDIRECT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const result = await resolveProductClick(slug, {
    timeoutMs: Number(process.env.CLICK_RESOLVE_TIMEOUT_MS ?? 2000),
    allowedHosts,
  });

  await recordEvent(slug, result.result, client);

  if (result.result === "NOT_FOUND") {
    return (
      <Interstitial
        icon={<PackageX className="size-6 text-muted-foreground" />}
        title="商品不可用"
        message={result.message}
        slug={slug}
      />
    );
  }

  if (result.result === "UNAVAILABLE") {
    return (
      <Interstitial
        icon={<PackageX className="size-6 text-state-out" />}
        title={
          result.availability === ("OUT_OF_STOCK" as Availability)
            ? "暂时缺货"
            : "已下架"
        }
        message={`${result.message}，已为你拦截跳转。`}
        slug={slug}
      />
    );
  }

  if (result.result === "UNCONFIRMED") {
    return (
      <Interstitial
        icon={<AlertTriangle className="size-6 text-state-low" />}
        title="暂时无法确认状态"
        message={
          result.lastSuccessAt
            ? `我们暂时联系不上货源。上次确认为「${labelOf(result.lastKnownAvailability)}」，${formatConfirmedAt(new Date(result.lastSuccessAt))}。`
            : "我们暂时联系不上货源，无法确认这个商品的最新状态。"
        }
        slug={slug}
        continueUrl={result.redirectUrl}
      />
    );
  }

  // 有货 —— 直接跳走。
  redirect(result.redirectUrl);
}

function labelOf(availability: Availability): string {
  switch (availability) {
    case "IN_STOCK":
      return "有货";
    case "LOW_STOCK":
      return "库存紧张";
    case "OUT_OF_STOCK":
      return "缺货";
    default:
      return "未知";
  }
}

/** 埋点。IP 只存加盐哈希，不留明文（spec §22）。 */
async function recordEvent(
  slug: string,
  result: string,
  client: { ip: string | null; country: string | null; userAgent: string | null; referrer: string | null },
) {
  const product = await prisma.product.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!product) return;

  const eventType =
    result === "AVAILABLE"
      ? "REDIRECT"
      : result === "UNAVAILABLE"
        ? "BLOCKED_OUT_OF_STOCK"
        : "UNCONFIRMED";

  const salt = deriveHashSalt(process.env.CREDENTIAL_MASTER_KEY ?? "dev");

  await Promise.all([
    prisma.clickEvent.create({
      data: {
        productId: product.id,
        eventType,
        referrer: client.referrer,
        country: client.country,
        userAgentHash: hashWithSalt(client.userAgent, salt),
        ipHash: hashWithSalt(client.ip, salt),
      },
    }),
    prisma.product.update({
      where: { id: product.id },
      data: { clickCount: { increment: 1 }, lastViewedAt: new Date() },
    }),
  ]).catch(() => {
    // 埋点失败不能影响跳转。
  });
}

function Interstitial({
  icon,
  title,
  message,
  slug,
  continueUrl,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  slug: string;
  continueUrl?: string | null;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted">
          {icon}
        </span>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {message}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {/* 无法确认时仍允许用户自主决定 —— 我们不确定 ≠ 一定没有 */}
          {continueUrl ? (
            <a
              href={continueUrl}
              rel="noopener noreferrer nofollow"
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              仍然前往商品页
              <ExternalLink className="size-4" />
            </a>
          ) : null}

          <Link
            href={`/products/${slug}`}
            className={cn(
              buttonVariants({ variant: continueUrl ? "ghost" : "default" }),
              "w-full",
            )}
          >
            返回商品详情
          </Link>
        </div>
      </div>
    </main>
  );
}
