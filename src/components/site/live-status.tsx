"use client";

import { useEffect, useState } from "react";
import type { DisplayState } from "@/lib/freshness";
import { StatusBadge } from "@/components/status-badge";

/**
 * 实时状态（spec §14）。
 *
 * 页面主体走 CDN 缓存，状态这块单独拉——否则整页缓存 2 分钟，
 * 库存就永远显示 2 分钟前的。
 *
 * 数据过期时后台会自动排一个刷新任务，这里短轮询几次拿新结果。
 * 只轮询有限次数：用户不会盯着看太久，一直轮询纯属浪费。
 */
const MAX_POLLS = 5;
const POLL_INTERVAL_MS = 1500;

interface StatusResponse {
  displayState: DisplayState;
  confirmedAt: string | null;
  refreshQueued: boolean;
  syncStatus: string;
}

export function LiveStatus({
  slug,
  initialState,
  initialConfirmedAt,
  needsRefresh,
}: {
  slug: string;
  initialState: DisplayState;
  initialConfirmedAt: string | null;
  needsRefresh: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [confirmedAt, setConfirmedAt] = useState(initialConfirmedAt);

  useEffect(() => {
    // 数据还新鲜就不用打扰服务器。
    if (!needsRefresh) return;

    let cancelled = false;
    let polls = 0;

    const poll = async () => {
      if (cancelled || polls >= MAX_POLLS) return;
      polls += 1;

      try {
        const response = await fetch(`/api/public/products/${slug}/status`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const data = (await response.json()) as StatusResponse;
        if (cancelled) return;

        setState(data.displayState);
        setConfirmedAt(data.confirmedAt);

        // 还在刷新中就继续等，拿到确定结果就停。
        if (data.syncStatus === "CHECKING" || data.refreshQueued) {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        // 网络抖动不需要提示用户，页面上已有的状态仍然可用。
      }
    };

    const timer = setTimeout(poll, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, needsRefresh]);

  return (
    <div className="space-y-1">
      <StatusBadge state={state} confirmedAt={confirmedAt} />
    </div>
  );
}
