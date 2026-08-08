import { isSoldOut } from "../lib/catalog";
import type { Product } from "../lib/types";

/** 转义外部内容——商品标题来自货源平台，直接插 innerHTML 就是 XSS。 */
function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPrice(value: string | null): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  // 货币符号压小、数字放大：价格是要被比较的数据，让数字占视觉主位
  return `<span class="sym">¥</span>${n.toFixed(2).replace(/\.00$/, "")}`;
}

/** 库存不足这个数就算「吃紧」，值得用颜色提醒。 */
const LOW_STOCK = 10;

/** 库存状态：文案 + 配色类名。 */
function stockState(item: Product): { text: string; cls: string } {
  if (isSoldOut(item)) return { text: "售罄", cls: "is-out" };
  if (item.stockCount === null) return { text: "有货", cls: "is-live" };
  if (item.stockCount <= LOW_STOCK)
    return { text: `仅剩 ${item.stockCount}`, cls: "is-low" };
  return { text: `${item.stockCount} 件`, cls: "is-live" };
}

export function renderCard(item: Product): string {
  const sold = isSoldOut(item);
  const stock = stockState(item);

  return `<a class="card${sold ? " is-sold" : ""}" href="${esc(item.url)}"
   target="_blank" rel="noopener noreferrer">
  <div class="thumb">
    ${
      item.imageUrl
        ? `<img src="${esc(item.imageUrl)}" alt="" loading="lazy" decoding="async">`
        : // 没图时给个占位，避免留一块说不清的空白
          `<span class="thumb-empty" aria-hidden="true">无图</span>`
    }
    ${sold ? `<span class="badge">SOLD OUT</span>` : ""}
  </div>
  <div class="card-body">
    <div class="card-title">${esc(item.title)}</div>
    <div class="field">
      <span class="field-key">库存</span>
      <span class="field-val ${stock.cls}">${stock.text}</span>
    </div>
    <div class="field field-category">
      <span class="field-key">分类</span>
      <span class="field-val">${esc(item.category)}</span>
    </div>
    <div class="card-foot">
      <span class="price">${formatPrice(item.price)}</span>
      <span class="go">${sold ? "查看" : "去购买 →"}</span>
    </div>
  </div>
</a>`;
}

/** 骨架屏卡片，首屏加载时占位。 */
export function renderSkeletonCard(): string {
  return `<div class="card">
  <div class="thumb"></div>
  <div class="card-body">
    <div class="card-title"></div>
    <div class="card-foot"><span class="price"></span></div>
  </div>
</div>`;
}
