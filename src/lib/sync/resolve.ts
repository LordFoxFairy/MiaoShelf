import { prisma } from "@/lib/db";
import { connectorForAccount } from "@/lib/connectors";
import { refreshSourceProduct } from "@/lib/sync/refresh";
import { waitForRefreshResult, readRefreshResult } from "@/lib/cache";
import { computeFreshness } from "@/lib/freshness";
import { pickTargetUrl, validateRedirectUrl } from "@/lib/redirect";
import { Availability, SourceStatus } from "@/lib/enums";

/**
 * 点击前确认（spec §15）。
 *
 * 目标：尽量不让用户跳到一个已经买不到的页面，但也不能为了确认
 * 让用户干等。所以最多等 2 秒，等不到就按上次可信状态放行。
 */

export type ResolveResult =
  | {
      result: "AVAILABLE";
      canRedirect: true;
      redirectUrl: string;
      availability: Availability;
      checkedAt: string;
      freshness: "LIVE" | "CACHED";
    }
  | {
      result: "UNAVAILABLE";
      canRedirect: false;
      availability: Availability;
      message: string;
    }
  | {
      result: "UNCONFIRMED";
      canRedirect: false;
      allowManualContinue: true;
      redirectUrl: string | null;
      lastKnownAvailability: Availability;
      lastSuccessAt: string | null;
      message: string;
    }
  | {
      result: "NOT_FOUND";
      canRedirect: false;
      message: string;
    };

export async function resolveProductClick(
  slug: string,
  options: { timeoutMs?: number; allowedHosts: string[] },
): Promise<ResolveResult> {
  const timeoutMs = options.timeoutMs ?? 2000;

  const product = await prisma.product.findFirst({
    where: { slug, publicationStatus: "PUBLISHED" },
    include: { sourceProduct: true },
  });

  if (!product) {
    return { result: "NOT_FOUND", canRedirect: false, message: "商品不存在" };
  }

  const source = product.sourceProduct;
  const now = new Date();

  // 手工商品没有货源，直接用管理员填的地址。
  if (!source) {
    const url = await buildTargetUrl(product, null, options.allowedHosts);
    return url
      ? {
          result: "AVAILABLE",
          canRedirect: true,
          redirectUrl: url,
          availability: Availability.NOT_APPLICABLE,
          checkedAt: now.toISOString(),
          freshness: "CACHED",
        }
      : {
          result: "NOT_FOUND",
          canRedirect: false,
          message: "商品未配置跳转地址",
        };
  }

  const freshness = computeFreshness(
    { freshUntil: source.freshUntil, staleUntil: source.staleUntil },
    now,
  );

  // 30 秒内确认过且有货 —— 直接放行，不再打外部接口（spec §15.1）。
  const recentlyConfirmed =
    source.lastSuccessAt !== null &&
    now.getTime() - source.lastSuccessAt.getTime() < 30_000;

  if (recentlyConfirmed && freshness === "FRESH") {
    return decide(product, source, options.allowedHosts, "CACHED");
  }

  // 数据过期：尝试实时确认，但最多等 timeoutMs。
  const cached = await readRefreshResult(source.id);
  if (!cached) {
    // 没有别人在跑就自己跑一个高优先级刷新。
    void refreshSourceProduct(source.id, "CLICK_RESOLVE", {
      immediateOutOfStock: true,
    });
  }

  await waitForRefreshResult(source.id, timeoutMs);

  // 重新读一次最新状态。
  const fresh = await prisma.sourceProduct.findUnique({
    where: { id: source.id },
  });

  return decide(
    product,
    fresh ?? source,
    options.allowedHosts,
    fresh?.lastSuccessAt &&
      Date.now() - fresh.lastSuccessAt.getTime() < timeoutMs + 1000
      ? "LIVE"
      : "CACHED",
  );
}

async function decide(
  product: { id: string; targetUrlOverride: string | null; sourceProductId: string | null },
  source: {
    id: string;
    availability: string;
    sourceStatus: string;
    sourceUrl: string | null;
    lastSuccessAt: Date | null;
    syncStatus: string;
  },
  allowedHosts: string[],
  freshness: "LIVE" | "CACHED",
): Promise<ResolveResult> {
  const availability = source.availability as Availability;
  const sourceStatus = source.sourceStatus as SourceStatus;

  // 明确缺货或已下架 —— 拦住，别让用户白跑。
  if (availability === Availability.OUT_OF_STOCK) {
    return {
      result: "UNAVAILABLE",
      canRedirect: false,
      availability,
      message: "该商品刚刚确认暂时缺货",
    };
  }

  if (
    sourceStatus === SourceStatus.INACTIVE ||
    sourceStatus === SourceStatus.DELETED
  ) {
    return {
      result: "UNAVAILABLE",
      canRedirect: false,
      availability,
      message: "该商品已下架",
    };
  }

  const url = await buildTargetUrl(product, source, allowedHosts);
  if (!url) {
    return {
      result: "NOT_FOUND",
      canRedirect: false,
      message: "商品未配置有效的跳转地址",
    };
  }

  // 状态不明：不替用户做决定，给出上次可信状态让他自己判断（spec §15.1）。
  if (
    source.syncStatus === "ERROR" ||
    source.syncStatus === "AUTH_REQUIRED" ||
    availability === Availability.UNKNOWN
  ) {
    return {
      result: "UNCONFIRMED",
      canRedirect: false,
      allowManualContinue: true,
      redirectUrl: url,
      lastKnownAvailability: availability,
      lastSuccessAt: source.lastSuccessAt?.toISOString() ?? null,
      message: "暂时无法确认最新状态",
    };
  }

  return {
    result: "AVAILABLE",
    canRedirect: true,
    redirectUrl: url,
    availability,
    checkedAt: source.lastSuccessAt?.toISOString() ?? new Date().toISOString(),
    freshness,
  };
}

/**
 * 目标地址：管理员 override → 来源自带 → getLink 兜底。
 * 每一个候选都要过校验，防开放重定向和 SSRF（spec §15.3）。
 */
async function buildTargetUrl(
  product: { targetUrlOverride: string | null; sourceProductId: string | null },
  source: { id: string; sourceUrl: string | null } | null,
  allowedHosts: string[],
): Promise<string | null> {
  let candidate = pickTargetUrl({
    targetUrlOverride: product.targetUrlOverride,
    sourceUrl: source?.sourceUrl ?? null,
  });

  // 都没有就临时问一次外部接口要链接。
  if (!candidate && source) {
    const record = await prisma.sourceProduct.findUnique({
      where: { id: source.id },
      select: { sourceAccountId: true, externalId: true },
    });

    if (record) {
      const connector = await connectorForAccount(record.sourceAccountId);
      const link = await connector
        ?.resolveLink(record.externalId)
        .catch(() => null);

      candidate = pickTargetUrl({
        resolvedLink: link?.url ?? null,
        resolvedShortLink: link?.shortUrl ?? null,
      });
    }
  }

  if (!candidate) return null;

  const validation = validateRedirectUrl(candidate, allowedHosts);
  return validation.ok ? validation.url.toString() : null;
}
