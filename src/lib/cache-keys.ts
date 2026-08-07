/**
 * Redis key 与 TTL 约定（spec §13.3、§13.4）。
 *
 * 所有 key 集中在这里，禁止在业务代码里拼字符串——
 * 拼错一个字符就是静默的缓存穿透，很难查。
 */

const PREFIX = "catalog";

export const cacheKeys = {
  /** 商品详情页组合结果。 */
  productView: (productId: string) => `${PREFIX}:product:${productId}:view`,

  /** 货源商品的状态对象。 */
  sourceProductStatus: (sourceProductId: string) =>
    `${PREFIX}:source-product:${sourceProductId}:status`,

  /** 已解析的跳转地址。 */
  productRedirect: (productId: string) =>
    `${PREFIX}:product:${productId}:redirect`,

  /** 刷新锁：同一商品同一时刻只允许一个外部请求（spec §12.3）。 */
  refreshLock: (sourceProductId: string) =>
    `${PREFIX}:refresh-lock:${sourceProductId}`,

  /** 刷新结果，供并发请求复用而不是各自再打一次外部接口。 */
  refreshResult: (sourceProductId: string) =>
    `${PREFIX}:refresh-result:${sourceProductId}`,

  /**
   * 列表类缓存带 catalogVersion，发布/隐藏商品时版本号 +1，
   * 一次性让所有列表缓存失效，比逐个 key 删除可靠得多。
   */
  categoryProducts: (categoryId: string, version: number) =>
    `${PREFIX}:category:${categoryId}:products:v${version}`,

  searchResults: (queryHash: string, version: number) =>
    `${PREFIX}:search:${queryHash}:v${version}`,

  catalogVersion: () => `${PREFIX}:catalog-version`,

  /** 限流计数器（spec §15.4）。 */
  rateLimit: (scope: string, key: string) =>
    `${PREFIX}:ratelimit:${scope}:${key}`,

  /** Worker 心跳（spec §26）。 */
  workerHeartbeat: () => `${PREFIX}:worker:heartbeat`,
} as const;

/**
 * TTL（秒）。
 *
 * 注意：Redis TTL 只负责内存释放，不等于业务新鲜度。
 * "这条数据还能不能对用户声称有货"一律由 freshUntil/staleUntil 判断。
 */
export const cacheTtl = {
  productView: 600, // 10 分钟
  sourceProductStatus: 900, // 15 分钟
  categoryList: 60,
  searchResults: 60,
  productRedirect: 600,
  clickConfirm: 30,
  refreshLock: 30,
  refreshResult: 60,
} as const;
