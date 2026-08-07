import { prisma } from "@/lib/db";

/**
 * 同步进程心跳（spec §26）。
 *
 * 必须存数据库，不能存进程内存 —— Docker 部署时网站和同步进程是
 * 两个独立容器，内存不共享。之前存内存导致后台永远显示"同步未运行"，
 * 哪怕同步进程跑得好好的。
 *
 * 用 AppSetting 表，不额外建表：心跳就是一条配置记录。
 */

const HEARTBEAT_KEY = "worker:heartbeat";
/** 超过这个时间没心跳就认为同步进程挂了。心跳间隔 30 秒，留 3 倍余量。 */
const STALE_AFTER_MS = 90_000;

export async function writeHeartbeat(): Promise<void> {
  const now = new Date().toISOString();
  try {
    await prisma.appSetting.upsert({
      where: { key: HEARTBEAT_KEY },
      update: { value: now },
      create: { key: HEARTBEAT_KEY, value: now },
    });
  } catch {
    // 心跳写不进去不影响同步本身干活，不该让它把进程搞崩。
  }
}

export interface HeartbeatState {
  alive: boolean;
  lastBeatAt: Date | null;
}

export async function readHeartbeatState(
  staleAfterMs = STALE_AFTER_MS,
): Promise<HeartbeatState> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: HEARTBEAT_KEY },
    });
    if (!row) return { alive: false, lastBeatAt: null };

    // value 是 JSON 字段，SQLite 里存的是字符串
    const raw = typeof row.value === "string" ? row.value : String(row.value);
    const lastBeatAt = new Date(raw.replace(/^"|"$/g, ""));

    if (Number.isNaN(lastBeatAt.getTime())) {
      return { alive: false, lastBeatAt: null };
    }

    return {
      alive: Date.now() - lastBeatAt.getTime() < staleAfterMs,
      lastBeatAt,
    };
  } catch {
    return { alive: false, lastBeatAt: null };
  }
}
