import { readdirSync, unlinkSync } from "node:fs";

/** 把外部商品 ID 变成只包含安全字符的本地文件名。 */
export function imageFileStem(externalId: string): string {
  const stem = externalId.trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  return stem || "item";
}

/** 删除已经不属于当前商品目录的本地图片，避免缓存永久增长。 */
export function pruneOrphanImages(
  dir: string,
  activeExternalIds: Iterable<string>,
): number {
  const activeStems = new Set(
    Array.from(activeExternalIds, imageFileStem),
  );
  let removed = 0;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const extensionAt = entry.name.lastIndexOf(".");
    if (extensionAt <= 0) continue;

    const stem = entry.name.slice(0, extensionAt);
    if (activeStems.has(stem)) continue;

    unlinkSync(`${dir}/${entry.name}`);
    removed += 1;
  }

  return removed;
}
