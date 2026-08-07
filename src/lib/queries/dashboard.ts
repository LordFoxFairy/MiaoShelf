import { prisma } from "@/lib/db";

/**
 * 仪表盘统计（spec §17.1）。
 *
 * 用一次 $transaction 批量发出，而不是 8 个独立 await——
 * 后者会串行往返 8 次，首屏明显变慢。
 */
export interface DashboardStats {
  totalProducts: number;
  publishedProducts: number;
  draftProducts: number;
  outOfStockProducts: number;
  erroredProducts: number;
  accountsNeedingAuth: number;
  viewsToday: number;
  redirectsToday: number;
  recentRuns: RecentSyncRun[];
}

export interface RecentSyncRun {
  id: string;
  trigger: string;
  scope: string;
  status: string;
  itemsSeen: number;
  itemsChanged: number;
  itemsFailed: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  accountName: string | null;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const today = startOfToday();

  const [
    totalProducts,
    publishedProducts,
    draftProducts,
    outOfStockProducts,
    erroredProducts,
    accountsNeedingAuth,
    viewsToday,
    redirectsToday,
    recentRuns,
  ] = await prisma.$transaction([
    prisma.product.count(),
    prisma.product.count({ where: { publicationStatus: "PUBLISHED" } }),
    prisma.product.count({ where: { publicationStatus: "DRAFT" } }),
    prisma.product.count({
      where: { sourceProduct: { availability: "OUT_OF_STOCK" } },
    }),
    prisma.product.count({
      where: { sourceProduct: { syncStatus: { in: ["ERROR", "AUTH_REQUIRED"] } } },
    }),
    prisma.sourceAccount.count({
      where: {
        sessionStatus: { in: ["AUTH_REQUIRED", "NEEDS_VERIFICATION", "ERROR"] },
      },
    }),
    prisma.clickEvent.count({
      where: { eventType: "VIEW", createdAt: { gte: today } },
    }),
    prisma.clickEvent.count({
      where: { eventType: "REDIRECT", createdAt: { gte: today } },
    }),
    prisma.syncRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { sourceAccount: { select: { name: true } } },
    }),
  ]);

  return {
    totalProducts,
    publishedProducts,
    draftProducts,
    outOfStockProducts,
    erroredProducts,
    accountsNeedingAuth,
    viewsToday,
    redirectsToday,
    recentRuns: recentRuns.map((run) => ({
      id: run.id,
      trigger: run.trigger,
      scope: run.scope,
      status: run.status,
      itemsSeen: run.itemsSeen,
      itemsChanged: run.itemsChanged,
      itemsFailed: run.itemsFailed,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
      accountName: run.sourceAccount?.name ?? null,
    })),
  };
}
