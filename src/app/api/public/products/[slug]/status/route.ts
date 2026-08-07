import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  computeFreshness,
  formatConfirmedAt,
  resolveDisplayState,
} from "@/lib/freshness";
import { enqueueRefresh } from "@/lib/sync/queue";
import type {
  Availability,
  SourceStatus,
  SyncStatus,
} from "@/lib/enums";

/**
 * 商品状态查询（spec §14.2）。
 *
 * 主要读缓存/数据库。发现数据过期时会幂等地排一个后台刷新任务，
 * 但绝不阻塞等待外部接口 —— 用户不该为了看个状态等 15 秒。
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const product = await prisma.product.findFirst({
    where: { slug, publicationStatus: "PUBLISHED" },
    select: {
      id: true,
      sourceProduct: {
        select: {
          id: true,
          sourceStatus: true,
          availability: true,
          syncStatus: true,
          stockCount: true,
          lastSuccessAt: true,
          freshUntil: true,
          staleUntil: true,
        },
      },
    },
  });

  if (!product) {
    return NextResponse.json(
      { error: "商品不存在" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const source = product.sourceProduct;
  const now = new Date();

  const freshness = computeFreshness(
    {
      freshUntil: source?.freshUntil ?? null,
      staleUntil: source?.staleUntil ?? null,
    },
    now,
  );

  // 过期就排队刷新（幂等，同一商品同时只会有一个任务）。
  let refreshQueued = false;
  if (source && freshness !== "FRESH") {
    refreshQueued = await enqueueRefresh({
      sourceProductId: source.id,
      trigger: "PAGE_VIEW",
      scope: "PRICE_STOCK_STATUS",
    });
  }

  const displayState = resolveDisplayState({
    sourceStatus: (source?.sourceStatus ?? "UNKNOWN") as SourceStatus,
    availability: (source?.availability ?? "UNKNOWN") as Availability,
    syncStatus: (source?.syncStatus ?? "STALE") as SyncStatus,
    freshness,
    lastSuccessAt: source?.lastSuccessAt ?? null,
  });

  return NextResponse.json(
    {
      displayState,
      confirmedAt: formatConfirmedAt(source?.lastSuccessAt ?? null, now),
      availability: source?.availability ?? "UNKNOWN",
      sourceStatus: source?.sourceStatus ?? "UNKNOWN",
      syncStatus: source?.syncStatus ?? "STALE",
      stockCount: source?.stockCount ?? null,
      lastSuccessAt: source?.lastSuccessAt ?? null,
      freshUntil: source?.freshUntil ?? null,
      refreshQueued,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
