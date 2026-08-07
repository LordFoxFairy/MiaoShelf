import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { readHeartbeatState } from "@/lib/cache";
import { queueSize } from "@/lib/sync/queue";

/** 健康检查（spec §26）。供部署时的存活探针使用。 */
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = { web: "ok" };
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
    healthy = false;
  }

  const { alive, lastBeatAt } = await readHeartbeatState();
  // 同步进程没跑不算「不健康」——网站本身还能正常服务，
  // 只是状态不再自动更新，所以单独如实报告。
  checks.worker = alive ? "ok" : "stopped";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      workerLastBeatAt: lastBeatAt,
      queueSize: queueSize(),
      time: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
