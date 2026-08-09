import "./styles/app.css";

import {
  SECTIONS,
  SHOP_URL,
  STORE_URL,
  CATALOG_URL,
  type Item,
  type Section,
} from "./lib/services";

function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 商品图在数据里是相对路径（/img/xxx.webp），那是相对**商品站**的。
 * 门户在另一个域名下，直接用会 404，必须补上商品站的域名。
 */
function imgUrl(src: string): string {
  return src.startsWith("/") ? `${SHOP_URL}${src}` : src;
}

interface Product {
  title: string;
  imageUrl: string | null;
  price: string | null;
  stockCount: number | null;
  availabilityHint: string;
  url: string;
  category: string;
  goodsType: string;
}

const icons = {
  arrow: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 5l7 7-7 7"/></svg>`,
  cart: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 9h18l-1.5 11a2 2 0 0 1-2 1.8H6.5a2 2 0 0 1-2-1.8ZM8 9V6a4 4 0 0 1 8 0v3"/></svg>`,
};

/** 千分位，让大数字更好读。 */
function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

/**
 * Hero 里的实时商品条。
 *
 * 这是整页的说服力来源——与其写「商品丰富价格实惠」，不如把真实的
 * 商品图和价格摆出来。数据本来就有（商品站的 products.json），零成本。
 */
function renderStrip(items: Product[]): string {
  // 只展示 ChatGPT 和 Claude——主推就这两类。
  // 混进视频会员、Grok 之类会稀释重点，访客扫一眼抓不住卖什么。
  const WANTED = /gpt|chatgpt|claude/i;
  const picks = items
    .filter((p) => p.imageUrl && p.availabilityHint !== "OUT_OF_STOCK")
    .filter((p) => Number.isFinite(Number(p.price)))
    .filter((p) => WANTED.test(p.category))
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, 8);

  if (!picks.length) return "";

  return `<div class="strip" role="list" aria-label="部分在售商品">
    ${picks
      .map(
        (p) => `<a class="chip" role="listitem" href="${esc(p.url)}" target="_blank" rel="noopener">
      <img src="${esc(imgUrl(p.imageUrl!))}" alt="" loading="lazy" decoding="async">
      <span class="chip-t">${esc(p.title.slice(0, 14))}</span>
      <span class="chip-p">¥${esc(p.price)}</span>
    </a>`,
      )
      .join("")}
  </div>`;
}

function renderItem(s: Item): string {
  const limited = s.restricted === true;
  const soon = !s.url;
  const cls = `tool${limited ? " is-limited" : ""}${soon ? " is-soon" : ""}`;
  const inner = `
  <span class="tool-icon" aria-hidden="true">
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${esc(s.icon)}"/></svg>
  </span>
  <span class="tool-body">
    <span class="tool-name">${esc(s.name)}${s.tag ? `<em>${esc(s.tag)}</em>` : ""}</span>
    <span class="tool-desc">${esc(s.desc)}</span>
  </span>`;

  // 没有地址就别渲染成链接——点了没反应的链接对键盘和读屏用户是干扰
  return soon
    ? `<div class="${cls}" style="--accent:${esc(s.color)}" aria-disabled="true">${inner}</div>`
    : `<a class="${cls}" style="--accent:${esc(s.color)}" href="${esc(s.url)}" rel="noopener">${inner}</a>`;
}

/** 渲染一个分区；没有内容就整块跳过，不留空标题。 */
function renderSection(sec: Section): string {
  if (!sec.items.length) return "";
  return `<section class="sec">
  <div class="sec-head">
    <h2>${esc(sec.title)}</h2>
    ${sec.hint ? `<span class="sec-hint">${esc(sec.hint)}</span>` : ""}
  </div>
  <div class="tools">${sec.items.map(renderItem).join("")}</div>
</section>`;
}

/** 骨架：数据没回来之前先撑住布局，避免数字闪动。 */
function shell(statsHtml: string, stripHtml: string, total = "200+"): string {
  return `
<div class="wrap">
  <header class="top">
    <span class="logo">M</span>
    <span class="brand">miaokit</span>
  </header>

  <section class="hero">
    <p class="eyebrow">AI 工具 · 数字权益</p>
    <h1><span class="l1">GPT Plus 会员</span>
      <span class="l2">官方渠道，自动发货</span></h1>
    <p class="lede">
      直充与成品号都有，另有 Claude、Gemini、GROK 等
      共 <strong>${esc(total)}</strong> 件在售。
      <span class="fresh">价格库存每 5 分钟同步，页面上看到的就是当前价。</span>
    </p>

    <div class="cta">
      <a class="btn btn-primary" href="${esc(SHOP_URL)}">
        浏览全部商品 ${icons.arrow}
      </a>
      <a class="btn btn-ghost" href="${esc(STORE_URL)}" rel="noopener">
        ${icons.cart} 去小铺下单
      </a>
    </div>

    <dl class="stats">${statsHtml}</dl>
  </section>

  ${stripHtml}

  ${SECTIONS.map(renderSection).join("")}

  <footer>
    <span>miaokit.cloud</span>
    <span class="dot-sep">·</span>
    <a href="${esc(SHOP_URL)}">商品目录</a>
    <a href="${esc(STORE_URL)}" rel="noopener">小铺下单</a>
  </footer>
</div>`;
}

function stat(value: string, label: string): string {
  return `<div class="stat"><dt>${esc(value)}</dt><dd>${esc(label)}</dd></div>`;
}

const app = document.querySelector<HTMLDivElement>("#app")!;

// 先渲染骨架，数字位留空——避免数据回来前页面是空白
app.innerHTML = shell(
  stat("—", "件商品在售") + stat("—", "起") + stat("5 分钟", "同步一次"),
  "",
);

/**
 * 拉真实数据填进 Hero。
 *
 * 拉不到就保持骨架的占位符——主页的核心信息（做什么、去哪买）不依赖它，
 * 商品站挂了主页也不该跟着白屏。
 */
void (async () => {
  try {
    const res = await fetch(`${CATALOG_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { items?: Product[] };
    const items = data.items ?? [];
    if (!items.length) return;

    const live = items.filter((p) => p.availabilityHint !== "OUT_OF_STOCK");
    const prices = live
      .map((p) => Number(p.price))
      .filter((n) => Number.isFinite(n) && n > 0);
    const min = prices.length ? Math.min(...prices) : 0;
    const cats = new Set(items.map((p) => p.category)).size;


    app.innerHTML = shell(
      stat(fmt(live.length), "件商品在售") +
        stat(`¥${min.toFixed(2).replace(/\.?0+$/, "")}`, "最低价起") +
        stat(String(cats), "个分类"),
      renderStrip(items),
      fmt(live.length),
    );
  } catch {
    /* 拿不到数据不影响主页可用 */
  }
})();
