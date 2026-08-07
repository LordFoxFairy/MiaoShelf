import { cn } from "@/lib/utils";
import type { RecentSyncRun } from "@/lib/queries/dashboard";
import { EmptyState } from "@/components/admin/empty-state";
import { RefreshCw } from "lucide-react";

const TRIGGER_LABELS: Record<string, string> = {
  SCHEDULE: "定时",
  MANUAL: "手动",
  PAGE_VIEW: "访问触发",
  CLICK_RESOLVE: "点击确认",
  IMPORT: "导入",
  LOGIN: "登录",
};

const SCOPE_LABELS: Record<string, string> = {
  CATALOG: "全量货源",
  PRODUCT: "商品详情",
  STATUS: "状态",
  PRICE_STOCK: "价格库存",
};

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  QUEUED: { label: "排队中", className: "bg-muted text-muted-foreground" },
  RUNNING: { label: "运行中", className: "bg-accent text-accent-foreground" },
  SUCCESS: { label: "成功", className: "bg-state-ok-bg text-state-ok" },
  PARTIAL: { label: "部分成功", className: "bg-state-low-bg text-state-low" },
  FAILED: { label: "失败", className: "bg-state-out-bg text-state-out" },
  SKIPPED: { label: "已跳过", className: "bg-muted text-muted-foreground" },
};

function formatDuration(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SyncRunList({ runs }: { runs: RecentSyncRun[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="还没有同步记录"
        description="导入货源商品后，定时同步会自动开始运行。"
      />
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {runs.map((run) => {
        const status = STATUS_STYLES[run.status] ?? {
          label: run.status,
          className: "bg-muted text-muted-foreground",
        };

        return (
          <li
            key={run.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium",
                status.className,
              )}
            >
              {status.label}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {TRIGGER_LABELS[run.trigger] ?? run.trigger}
                <span className="text-muted-foreground">
                  {" · "}
                  {SCOPE_LABELS[run.scope] ?? run.scope}
                </span>
                {run.accountName ? (
                  <span className="text-muted-foreground">
                    {" · "}
                    {run.accountName}
                  </span>
                ) : null}
              </p>
              {run.error ? (
                <p className="truncate text-xs text-state-out">{run.error}</p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
              <span>
                {run.itemsChanged}/{run.itemsSeen} 项
              </span>
              {run.itemsFailed > 0 ? (
                <span className="text-state-out">{run.itemsFailed} 失败</span>
              ) : null}
              <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
