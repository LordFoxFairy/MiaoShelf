import { acquireRefreshLock } from "@/lib/cache";
import { TRIGGER_PRIORITY, type RefreshScope, type RefreshTrigger } from "@/lib/enums";

/**
 * 刷新任务队列（spec §12）。
 *
 * 进程内优先队列。四种触发来源（定时/手动/访问/点击）全部走这一个入口，
 * 保证去重和优先级只有一套逻辑。
 *
 * 为什么不用 BullMQ：那需要 Redis，而我们单机 SQLite 部署。
 * 接口保持异步，将来要换分布式队列只改这个文件。
 */

export interface RefreshJob {
  sourceProductId: string;
  trigger: RefreshTrigger;
  scope: RefreshScope;
  priority: number;
  enqueuedAt: number;
}

/** 待处理任务，按优先级排序。 */
const queue: RefreshJob[] = [];
/** 已入队的商品，防止同一商品排多次（spec §12.3）。 */
const pending = new Set<string>();

/**
 * 提交刷新任务。
 *
 * @returns true 表示新排了一个任务；false 表示已有同商品任务在跑，
 *          调用方应该去复用它的结果而不是自己发一次外部请求。
 */
export async function enqueueRefresh(input: {
  sourceProductId: string;
  trigger: RefreshTrigger;
  scope: RefreshScope;
}): Promise<boolean> {
  const { sourceProductId, trigger, scope } = input;

  // 已经在队列里了，不重复排。
  if (pending.has(sourceProductId)) return false;

  // 拿不到锁说明别人正在刷同一个商品。
  const gotLock = await acquireRefreshLock(sourceProductId);
  if (!gotLock) return false;

  const job: RefreshJob = {
    sourceProductId,
    trigger,
    scope,
    priority: TRIGGER_PRIORITY[trigger],
    enqueuedAt: Date.now(),
  };

  pending.add(sourceProductId);

  // 插入到第一个优先级更低的任务之前，保证用户在等的请求排在定时任务前面。
  const index = queue.findIndex((existing) => existing.priority > job.priority);
  if (index === -1) queue.push(job);
  else queue.splice(index, 0, job);

  return true;
}

/** 取出下一个任务。队列空时返回 null。 */
export function dequeueRefresh(): RefreshJob | null {
  const job = queue.shift() ?? null;
  if (job) pending.delete(job.sourceProductId);
  return job;
}

export function queueSize(): number {
  return queue.length;
}

export function isPending(sourceProductId: string): boolean {
  return pending.has(sourceProductId);
}

/** 仅供测试。 */
export function __resetQueue(): void {
  queue.length = 0;
  pending.clear();
}
