import { readFileSync } from "node:fs";

/** 读取上一次成功写入的商品数量；文件不存在或损坏时返回 null。 */
export function readCatalogItemCount(path: string): number | null {
  try {
    const catalog = JSON.parse(readFileSync(path, "utf8")) as { items?: unknown };
    return Array.isArray(catalog.items) ? catalog.items.length : null;
  } catch {
    return null;
  }
}

/** 大幅减少通常意味着分页或某个商品类型临时拉取不完整。 */
export function isSuspiciousCatalogDrop(
  currentCount: number,
  previousCount: number | null,
  maxDropRatio = 0.5,
): boolean {
  if (previousCount === null || previousCount <= 0) return false;
  return (previousCount - currentCount) / previousCount > maxDropRatio;
}
