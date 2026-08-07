import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * 指标卡。
 * 数字用等宽字形（tabular-nums），否则数值变化时宽度会跳。
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const toneStyles = {
    default: "text-foreground",
    ok: "text-state-ok",
    warn: "text-state-low",
    danger: "text-state-out",
  }[tone];

  return (
    <Card className="gap-0 p-5 shadow-xs transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon ? (
          <Icon className="size-4 shrink-0 text-muted-foreground/60" />
        ) : null}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", toneStyles)}>
        {value}
      </div>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}
