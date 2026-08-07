import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { connectorForAccount } from "@/lib/connectors";
import { ConnectorError } from "@/lib/connectors/types";
import {
  releaseRefreshLock,
  writeRefreshResult,
  bumpCatalogVersion,
} from "@/lib/cache";
import {
  resolveAvailability,
  resolveAvailabilityForClick,
  syncStatusForFailure,
  type FailureKind,
} from "@/lib/freshness";
import {
  classifyPopularity,
  computeFreshnessWindow,
  computeNextCheckAt,
} from "@/lib/scheduling";
import { safeErrorDetail } from "@/lib/connectors/normalize";
import {
  Availability,
  SourceStatus,
  SyncStatus,
  type RefreshTrigger,
} from "@/lib/enums";

/**
 * 单个商品刷新（spec §13.5、§16）。
 *
 * 这是整个系统最要紧的一段代码。核心不变量：
 *
 *   外部请求失败 ⇒ 保留上一次成功的价格/库存/状态，只更新错误计数。
 *   缺货只能来自一次成功响应里明确的 stockCount === 0，且要连续两次。
 *
 * 违反这条，一次网络抖动就会把整站商品打成缺货。
 */

export interface RefreshOutcome {
  ok: boolean;
  changed: boolean;
  availability: Availability;
  sourceStatus: SourceStatus;
  stockCount: number | null;
  error?: string;
}

export async function refreshSourceProduct(
  sourceProductId: string,
  trigger: RefreshTrigger,
  options: { lowStockThreshold?: number; immediateOutOfStock?: boolean } = {},
): Promise<RefreshOutcome> {
  const lowStockThreshold = options.lowStockThreshold ?? 5;

  const existing = await prisma.sourceProduct.findUnique({
    where: { id: sourceProductId },
    include: {
      products: { select: { lastViewedAt: true, publicationStatus: true } },
    },
  });

  if (!existing) {
    return {
      ok: false,
      changed: false,
      availability: Availability.UNKNOWN,
      sourceStatus: SourceStatus.UNKNOWN,
      stockCount: null,
      error: "商品不存在",
    };
  }

  const now = new Date();

  try {
    const connector = await connectorForAccount(existing.sourceAccountId);
    if (!connector) throw new ConnectorError("AUTH", "货源账号不可用");

    await prisma.sourceProduct.update({
      where: { id: sourceProductId },
      data: { syncStatus: SyncStatus.CHECKING },
    });

    const goods = await connector.fetchDetail(existing.externalId);

    // —— 到这里说明请求成功了，可以放心更新状态 ——

    const previousAvailability = existing.availability as Availability;

    /*
     * 库存字段可能在这次响应里根本没有（比如小铺的单品详情接口就不返回，
     * 只有列表接口有）。这种情况保留上一次的库存，而不是覆盖成 null——
     * 「这次没给」和「确实没货」是两回事，跟"失败不等于缺货"是同一个道理。
     */
    const stock =
      goods.stockCount === null && existing.stockCount !== null
        ? existing.stockCount
        : goods.stockCount;

    const resolved = options.immediateOutOfStock
      ? {
          // 点击确认走快路径：明确 0 就立刻判缺货，不等第二次（spec §16.2）
          availability: resolveAvailabilityForClick(stock, lowStockThreshold),
          consecutiveOutOfStock:
            stock === 0 ? existing.consecutiveOutOfStock + 1 : 0,
        }
      : resolveAvailability(
          stock,
          existing.consecutiveOutOfStock,
          lowStockThreshold,
          previousAvailability,
        );

    const popularity = classifyPopularity(
      existing.products[0]?.lastViewedAt ?? null,
      now,
    );
    const { freshUntil, staleUntil } = computeFreshnessWindow(popularity, now);

    const nextCheckAt = computeNextCheckAt(
      {
        syncStatus: SyncStatus.FRESH,
        availability: resolved.availability,
        popularity,
        consecutiveFailures: 0,
        consecutiveOutOfStock: resolved.consecutiveOutOfStock,
      },
      now,
    );

    const newPrice = goods.price;
    const oldPrice = existing.sourcePrice
      ? new Decimal(String(existing.sourcePrice))
      : null;

    const changed =
      existing.availability !== resolved.availability ||
      existing.sourceStatus !== goods.sourceStatus ||
      existing.stockCount !== stock ||
      !samePrice(oldPrice, newPrice);

    await prisma.$transaction(async (tx) => {
      await tx.sourceProduct.update({
        where: { id: sourceProductId },
        data: {
          sourceTitle: goods.title ?? existing.sourceTitle,
          sourcePrice: newPrice ? newPrice.toString() : existing.sourcePrice,
          stockCount: stock,
          sourceStatus: goods.sourceStatus,
          availability: resolved.availability,
          syncStatus: SyncStatus.FRESH,
          sourceUrl: goods.url ?? existing.sourceUrl,
          rawPayload: JSON.stringify(goods.raw),
          lastCheckedAt: now,
          lastSuccessAt: now,
          freshUntil,
          staleUntil,
          nextCheckAt,
          consecutiveFailures: 0,
          consecutiveOutOfStock: resolved.consecutiveOutOfStock,
          lastError: null,
        },
      });

      // 只在真的变化时记历史，否则每分钟一条会撑爆表。
      if (changed) {
        await tx.statusHistory.create({
          data: {
            sourceProductId,
            oldSourceStatus: existing.sourceStatus,
            newSourceStatus: goods.sourceStatus,
            oldAvailability: existing.availability,
            newAvailability: resolved.availability,
            oldPrice: existing.sourcePrice,
            newPrice: newPrice ? newPrice.toString() : null,
            oldStockCount: existing.stockCount,
            newStockCount: stock,
            trigger,
            observedAt: now,
          },
        });
      }
    });

    await writeRefreshResult(sourceProductId, {
      ok: true,
      availability: resolved.availability,
      sourceStatus: goods.sourceStatus,
      stockCount: stock,
      checkedAt: now.toISOString(),
    });

    // 影响公开列表时让列表缓存整体失效。
    if (changed && existing.products.some((p) => p.publicationStatus === "PUBLISHED")) {
      await bumpCatalogVersion();
    }

    return {
      ok: true,
      changed,
      availability: resolved.availability,
      sourceStatus: goods.sourceStatus,
      stockCount: stock,
    };
  } catch (error) {
    return handleFailure(existing, error, now);
  } finally {
    await releaseRefreshLock(sourceProductId);
  }
}

/**
 * 失败处理 —— 这里是整个不变量的落地点。
 *
 * 注意下面的 update 里**没有** availability / sourceStatus / stockCount /
 * sourcePrice / lastSuccessAt。它们保持不动，用户继续看到上次可信的结果，
 * 前台显示"暂时无法确认 · 上次有货，N 分钟前确认"。
 */
async function handleFailure(
  existing: { id: string; consecutiveFailures: number; availability: string; sourceStatus: string; stockCount: number | null },
  error: unknown,
  now: Date,
): Promise<RefreshOutcome> {
  const kind: FailureKind =
    error instanceof ConnectorError ? error.kind : "UNKNOWN";
  const message =
    error instanceof Error ? safeErrorDetail(error.message) : "未知错误";

  const failures = existing.consecutiveFailures + 1;
  const syncStatus = syncStatusForFailure(kind);

  const nextCheckAt = computeNextCheckAt(
    {
      syncStatus,
      availability: existing.availability as Availability,
      popularity: "NORMAL",
      consecutiveFailures: failures,
      consecutiveOutOfStock: 0,
    },
    now,
  );

  await prisma.sourceProduct.update({
    where: { id: existing.id },
    data: {
      // 只动这几个字段。库存和状态一律不碰。
      syncStatus,
      lastCheckedAt: now,
      nextCheckAt,
      consecutiveFailures: failures,
      lastError: message,
    },
  });

  return {
    ok: false,
    changed: false,
    availability: existing.availability as Availability,
    sourceStatus: existing.sourceStatus as SourceStatus,
    stockCount: existing.stockCount,
    error: message,
  };
}

function samePrice(a: Decimal | null, b: Decimal | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.equals(b);
}
