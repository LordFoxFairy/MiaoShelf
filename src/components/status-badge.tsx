import { cn } from "@/lib/utils";
import type { DisplayState } from "@/lib/freshness";

/**
 * 状态徽章（spec §7.5、§18.4）。
 *
 * 颜色之外必须同时有文字：色盲用户和黑白打印都要能分辨，
 * 所以这里从来不做"只有一个绿点"的设计。
 */
const TONE_STYLES: Record<DisplayState["tone"], string> = {
  AVAILABLE: "bg-state-ok-bg text-state-ok",
  LOW: "bg-state-low-bg text-state-low",
  UNAVAILABLE: "bg-state-out-bg text-state-out",
  INACTIVE: "bg-state-unknown-bg text-state-unknown",
  CHECKING: "bg-accent text-accent-foreground",
  UNKNOWN: "bg-state-unknown-bg text-state-unknown",
};

export function StatusBadge({
  state,
  confirmedAt,
  className,
}: {
  state: DisplayState;
  /** "3 分钟前确认"。传了就显示在徽章后面。 */
  confirmedAt?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          TONE_STYLES[state.tone],
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full bg-current",
            state.tone === "CHECKING" && "animate-pulse",
          )}
        />
        {state.label}
      </span>
      {confirmedAt ? (
        <span className="text-xs text-muted-foreground">{confirmedAt}</span>
      ) : null}
    </span>
  );
}
