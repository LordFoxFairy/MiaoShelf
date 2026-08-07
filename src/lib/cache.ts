import { cacheKeys, cacheTtl } from "@/lib/cache-keys";

/**
 * 缓存层。
 *
 * 单机部署（SQLite / Cloudflare D1）用不上 Redis，所以这里是进程内实现：
 *   - 一个 Map 存值 + 过期时间
 *   - 刷新锁靠"检查并写入"在单线程 JS 里天然原子
 *
 * 接口刻意做成异步，将来要换 Redis 只改这个文件，调用方一行不动。
 *
 * 已知取舍：多进程部署时各进程缓存独立，刷新锁不跨进程。
 * 对单机场景没问题；真要水平扩展时再换 Redis。
 */

interface Entry {
  value: string;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** 惰性清理：读到过期项时删掉，避免定时器在 serverless 环境里泄漏。 */
function readRaw(key: string): string | null {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function writeRaw(key: string, value: string, ttlSeconds: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function readJson<T>(key: string): Promise<T | null> {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  writeRaw(key, JSON.stringify(value), ttlSeconds);
}

export async function del(...keys: string[]): Promise<void> {
  for (const key of keys) store.delete(key);
}

/**
 * 获取刷新锁（spec §12.3）。
 *
 * 100 个用户同时点同一个商品时，只有第一个拿到锁去打外部接口，
 * 其余的复用它的结果。JS 单线程保证了这里的 check-then-set 是原子的。
 */
export async function acquireRefreshLock(
  sourceProductId: string,
  ttlSeconds = cacheTtl.refreshLock,
): Promise<boolean> {
  const key = cacheKeys.refreshLock(sourceProductId);
  if (readRaw(key) !== null) return false;
  writeRaw(key, "1", ttlSeconds);
  return true;
}

export async function releaseRefreshLock(
  sourceProductId: string,
): Promise<void> {
  await del(cacheKeys.refreshLock(sourceProductId));
}

export interface CachedRefreshResult {
  ok: boolean;
  availability: string;
  sourceStatus: string;
  stockCount: number | null;
  checkedAt: string;
}

export async function readRefreshResult(
  sourceProductId: string,
): Promise<CachedRefreshResult | null> {
  return readJson<CachedRefreshResult>(
    cacheKeys.refreshResult(sourceProductId),
  );
}

export async function writeRefreshResult(
  sourceProductId: string,
  result: CachedRefreshResult,
): Promise<void> {
  await writeJson(
    cacheKeys.refreshResult(sourceProductId),
    result,
    cacheTtl.refreshResult,
  );
}

/** 等别人正在跑的刷新出结果（spec §15.1，最多等 2 秒）。 */
export async function waitForRefreshResult(
  sourceProductId: string,
  timeoutMs: number,
  pollIntervalMs = 50,
): Promise<CachedRefreshResult | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await readRefreshResult(sourceProductId);
    if (result) return result;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return null;
}

/** catalogVersion：列表缓存的整体失效开关（spec §13.5）。 */
let catalogVersion = 0;

export async function getCatalogVersion(): Promise<number> {
  return catalogVersion;
}

export async function bumpCatalogVersion(): Promise<number> {
  catalogVersion += 1;
  // 版本变了，旧的列表缓存直接清掉，不等 TTL。
  for (const key of store.keys()) {
    if (key.includes(":products:v") || key.includes("catalog:search:")) {
      store.delete(key);
    }
  }
  return catalogVersion;
}

/** 固定窗口限流（spec §15.4）。 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

const counters = new Map<string, { count: number; expiresAt: number }>();

export async function checkRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = cacheKeys.rateLimit(scope, key);
  const now = Date.now();

  const existing = counters.get(redisKey);
  if (!existing || now > existing.expiresAt) {
    counters.set(redisKey, {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    });
    return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetSeconds: Math.ceil((existing.expiresAt - now) / 1000),
  };
}

/** Worker 心跳（spec §26）。 */
let heartbeat: Date | null = null;

export async function writeHeartbeat(): Promise<void> {
  heartbeat = new Date();
}

export async function readHeartbeat(): Promise<Date | null> {
  return heartbeat;
}

/**
 * 同步进程是否还活着。
 *
 * 判活的时间比较放在这里而不是组件里：组件渲染必须是纯函数，
 * 读当前时间属于副作用，放进去会让同一份数据在不同渲染得出不同结果。
 */
export interface HeartbeatState {
  alive: boolean;
  lastBeatAt: Date | null;
}

export async function readHeartbeatState(
  staleAfterMs = 90_000,
): Promise<HeartbeatState> {
  const lastBeatAt = await readHeartbeat();
  return {
    alive:
      lastBeatAt !== null &&
      Date.now() - lastBeatAt.getTime() < staleAfterMs,
    lastBeatAt,
  };
}

/** 仅供测试。 */
export function __resetCache(): void {
  store.clear();
  counters.clear();
  catalogVersion = 0;
  heartbeat = null;
}
