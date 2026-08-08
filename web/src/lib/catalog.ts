import type { Catalog, CategoryGroup, Product } from "./types";

/**
 * 取商品数据。
 *
 * 带时间戳查询参数绕开 CDN 缓存——Cloudflare Pages 默认会缓存静态资源，
 * 不加这个的话推了新 JSON 用户还是看到旧库存，那就失去同步的意义了。
 */
export async function loadCatalog(): Promise<Catalog> {
  const response = await fetch(`/products.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`拿不到商品数据（${response.status}）`);
  }
  const data = (await response.json()) as Catalog;
  if (!Array.isArray(data.items)) {
    throw new Error("商品数据格式不对");
  }
  return data;
}

/** 分类名转成安全的锚点 id——分类名含中文和括号，不能直接进 URL 片段。 */
export function slugify(name: string, index: number): string {
  return `c${index}-${name.replace(/[^\w一-龥]+/g, "").slice(0, 12) || "x"}`;
}

/** 按分类分组，商品多的排前面。 */
export function groupByCategory(items: Product[]): CategoryGroup[] {
  const map = new Map<string, Product[]>();
  for (const item of items) {
    const name = item.category?.trim() || "其他";
    const list = map.get(name);
    if (list) list.push(item);
    else map.set(name, [item]);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, list], i) => ({ name, slug: slugify(name, i), items: list }));
}

export function isSoldOut(item: Product): boolean {
  return item.availabilityHint === "OUT_OF_STOCK";
}

/** 关键词过滤，标题和分类都匹配。 */
export function filterProducts(items: Product[], keyword: string): Product[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q),
  );
}
