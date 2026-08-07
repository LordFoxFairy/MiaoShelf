import { readHeartbeatState } from "@/lib/heartbeat";
import { cn } from "@/lib/utils";

/**
 * 同步进程心跳指示灯（spec §26）。
 *
 * 放在顶栏是因为它是"整个系统还在正常工作吗"最直接的信号——
 * 同步停了但页面还在正常显示，是这类系统最危险的静默故障。
 */
export async function WorkerStatus() {
  const { alive, lastBeatAt } = await readHeartbeatState();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        alive
          ? "bg-state-ok-bg text-state-ok"
          : "bg-state-unknown-bg text-state-unknown",
      )}
      title={
        lastBeatAt
          ? `最近心跳：${lastBeatAt.toLocaleString("zh-CN")}`
          : "同步进程尚未启动（pnpm worker）"
      }
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          alive && "animate-pulse",
        )}
      />
      {alive ? "同步运行中" : "同步未运行"}
    </span>
  );
}
