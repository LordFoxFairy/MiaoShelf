import { RefreshCw } from "lucide-react";

import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { SyncRunList } from "@/components/admin/sync-run-list";
import { StatCard } from "@/components/admin/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readHeartbeatState } from "@/lib/heartbeat";

export const metadata = { title: "同步任务" };
export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const [runs, counts, { alive, lastBeatAt }] = await Promise.all([
    prisma.syncRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { sourceAccount: { select: { name: true } } },
    }),
    prisma.sourceProduct.groupBy({
      by: ["syncStatus"],
      _count: true,
    }),
    readHeartbeatState(),
  ]);

  const byStatus = Object.fromEntries(
    counts.map((c) => [c.syncStatus, c._count]),
  ) as Record<string, number>;

  return (
    <>
      <PageHeader
        title="同步任务"
        description="定时同步、手动刷新、访问触发与点击确认都会在这里留下记录。"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="同步进程"
          value={alive ? "运行中" : "未运行"}
          hint={
            lastBeatAt
              ? `最近心跳 ${new Date(lastBeatAt).toLocaleTimeString("zh-CN")}`
              : "执行 pnpm worker 启动"
          }
          tone={alive ? "ok" : "warn"}
        />
        <StatCard label="数据新鲜" value={byStatus.FRESH ?? 0} tone="ok" />
        <StatCard label="等待刷新" value={byStatus.STALE ?? 0} />
        <StatCard
          label="同步异常"
          value={(byStatus.ERROR ?? 0) + (byStatus.AUTH_REQUIRED ?? 0)}
          hint="仍展示上次可信状态"
          tone={
            (byStatus.ERROR ?? 0) + (byStatus.AUTH_REQUIRED ?? 0) > 0
              ? "danger"
              : "default"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">任务记录</CardTitle>
        </CardHeader>
        <CardContent>
          <SyncRunList
            runs={runs.map((run) => ({
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
            }))}
          />
        </CardContent>
      </Card>

      {!alive ? (
        <p className="flex items-center gap-2 rounded-xl bg-state-low-bg px-4 py-3 text-sm text-state-low">
          <RefreshCw className="size-4 shrink-0" />
          同步进程未运行，商品状态不会自动更新。在服务器上执行{" "}
          <code className="rounded bg-background/60 px-1.5 py-0.5 text-xs">
            pnpm worker
          </code>
        </p>
      ) : null}
    </>
  );
}
