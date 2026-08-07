/**
 * 同步进程（spec §12、§26）。
 *
 *   pnpm worker
 *
 * 干三件事：
 *  1. 每 60 秒扫一遍到期该检查的商品，排进队列
 *  2. 持续消费队列，按优先级刷新
 *  3. 每 30 秒写一次心跳，后台顶栏能看到"同步运行中"
 *
 * 和 Web 分开跑，避免长任务拖慢页面响应。
 */
import { PrismaClient } from "@prisma/client";
import { dequeueRefresh, enqueueRefresh, queueSize } from "@/lib/sync/queue";
import { refreshSourceProduct } from "@/lib/sync/refresh";
import { writeHeartbeat } from "@/lib/cache";

const prisma = new PrismaClient();

const SCHEDULER_INTERVAL_MS =
  Number(process.env.SYNC_SCHEDULER_INTERVAL_SECONDS ?? 60) * 1000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);
/** 同时进行的外部请求数，别把货源接口打爆（spec §12.4）。 */
const CONCURRENCY = Number(process.env.GLOBAL_SOURCE_CONCURRENCY ?? 3);

let running = true;
let activeWorkers = 0;

function log(message: string, extra?: Record<string, unknown>) {
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`, extra ? JSON.stringify(extra) : "");
}

/** 扫描到期商品并排队。 */
async function schedule() {
  const now = new Date();

  const due = await prisma.sourceProduct.findMany({
    where: {
      // AUTH_REQUIRED 不参与自动排队，等人工重新登录（spec §12.6）
      syncStatus: { not: "AUTH_REQUIRED" },
      sourceAccount: { isEnabled: true },
      OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
    },
    select: { id: true },
    orderBy: { nextCheckAt: "asc" },
    take: 100,
  });

  let queued = 0;
  for (const item of due) {
    const added = await enqueueRefresh({
      sourceProductId: item.id,
      trigger: "SCHEDULE",
      scope: "PRICE_STOCK_STATUS",
    });
    if (added) queued += 1;
  }

  if (queued > 0) {
    log(`已排队 ${queued} 个商品`, { due: due.length, queue: queueSize() });
  }
}

/** 消费队列。 */
async function drain() {
  while (running && activeWorkers < CONCURRENCY) {
    const job = dequeueRefresh();
    if (!job) break;

    activeWorkers += 1;

    void refreshSourceProduct(job.sourceProductId, job.trigger, {
      lowStockThreshold: LOW_STOCK_THRESHOLD,
    })
      .then((outcome) => {
        if (!outcome.ok) {
          // 失败只记日志，数据保持上一次可信状态。
          log(`刷新失败 ${job.sourceProductId}`, { error: outcome.error });
        } else if (outcome.changed) {
          log(`状态变化 ${job.sourceProductId}`, {
            availability: outcome.availability,
            stock: outcome.stockCount,
          });
        }
      })
      .catch((error) => {
        log(`刷新异常 ${job.sourceProductId}`, { error: String(error) });
      })
      .finally(() => {
        activeWorkers -= 1;
      });
  }
}

async function main() {
  log("同步进程启动", {
    concurrency: CONCURRENCY,
    schedulerIntervalMs: SCHEDULER_INTERVAL_MS,
  });

  await writeHeartbeat();
  await schedule();

  const schedulerTimer = setInterval(() => {
    void schedule().catch((error) => log("调度失败", { error: String(error) }));
  }, SCHEDULER_INTERVAL_MS);

  const heartbeatTimer = setInterval(() => {
    void writeHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  // 队列消费得比调度勤，否则高优先级任务要等一整个周期。
  const drainTimer = setInterval(() => {
    void drain().catch((error) => log("消费失败", { error: String(error) }));
  }, 500);

  const shutdown = async () => {
    if (!running) return;
    running = false;
    log("正在停止…");

    clearInterval(schedulerTimer);
    clearInterval(heartbeatTimer);
    clearInterval(drainTimer);

    // 给在跑的任务一点时间收尾。
    const deadline = Date.now() + 10_000;
    while (activeWorkers > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }

    await prisma.$disconnect();
    log("已停止");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error("同步进程启动失败：", error);
  process.exit(1);
});
