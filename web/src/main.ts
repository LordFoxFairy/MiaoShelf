import "./styles/app.css";

import { renderCard, renderSkeletonCard } from "./components/product-card";
import {
  filterProducts,
  groupByCategory,
  isSoldOut,
  loadCatalog,
} from "./lib/catalog";
import { GOODS_TYPE_LABEL } from "./lib/types";
import type { Catalog, Product } from "./lib/types";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** 库存视图：全部 / 仅有货 / 仅售罄。对应顶部分段导航。 */
type StockView = "all" | "live" | "sold";

let catalog: Catalog | null = null;
let keyword = "";
let activeCategory: string | null = null;
// 默认只看有货——售罄的挡在前面对买家没意义，想看全部随时能切
let stockView: StockView = "live";
/** 一级大类：小铺自带的 card / equity。null=全部。 */
let goodsType: string | null = null;
/** 进站默认展示的大类——卡密是主推品类。 */
const DEFAULT_GOODS_TYPE = "card";
/** 按价格升序排。默认开——同类商品价差大，升序才好比价。 */
let sortByPrice = true;

function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** 分类首字，给侧栏图标用——比统一图标更好认。 */
function initial(name: string): string {
  const ch = name.trim()[0] ?? "?";
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
}

/**
 * 分类图标底色。
 *
 * 参考图侧栏用的是**彩色应用图标**，不是统一的灰底。这里按分类名做稳定散列
 * 取色——同一个分类每次刷新颜色不变，用户能靠颜色记住位置。
 */
const ICON_COLORS = [
  "#3b6ef5",
  "#10a37f",
  "#8b5cf6",
  "#ef6820",
  "#e5484d",
  "#0ea5e9",
  "#d946a0",
  "#16a34a",
  "#f0a500",
  "#6366f1",
] as const;

const icons = {
  search: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12"/></svg>`,
  grid: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5"/></svg>`,
  ban: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>`,
  sort: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 7h11M4 12h7M4 17h4"/><path d="M17 10v8m0 0 3-3m-3 3-3-3"/></svg>`,
  folder: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
  caret: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6"/></svg>`,
  card: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/></svg>`,
  crown: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 7l4 4 5-6 5 6 4-4v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
  reload: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></svg>`,
};

function renderLoading(): void {
  app.innerHTML = `<div class="layout">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">··</div>
      <div class="brand-text"><strong>载入中</strong><span>SYNCING</span></div>
    </div>
  </aside>
  <main class="work">
    <div class="grid is-skeleton">${Array.from({ length: 8 }, renderSkeletonCard).join("")}</div>
  </main>
</div>`;
}

function renderError(message: string): void {
  app.innerHTML = `<div class="layout">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">!</div>
      <div class="brand-text"><strong>出错了</strong><span>ERROR</span></div>
    </div>
  </aside>
  <main class="work"><div class="state">
    <h2>没能载入商品</h2>
    <p>${esc(message)}</p>
    <button type="button" id="retry">重新载入</button>
  </div></main>
</div>`;
  document
    .querySelector<HTMLButtonElement>("#retry")
    ?.addEventListener("click", () => void boot());
}

/** 小铺的一级大类及其数量，按商品数排序。 */
function goodsTypes(): Array<{ key: string; label: string; count: number }> {
  if (!catalog) return [];
  // 口径要和侧栏、列表一致——过搜索和库存筛选（但不过分类，
  // 因为大类是分类的上级，被下级过滤会自相矛盾）。
  let pool = filterProducts(catalog.items, keyword);
  if (stockView === "live") pool = pool.filter((p) => !isSoldOut(p));
  else if (stockView === "sold") pool = pool.filter(isSoldOut);

  const counts = new Map<string, number>();
  for (const item of pool) {
    counts.set(item.goodsType, (counts.get(item.goodsType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => {
      // 默认大类排最前，和「进站就落在它上面」保持一致；其余按商品数
      if (a[0] === DEFAULT_GOODS_TYPE) return -1;
      if (b[0] === DEFAULT_GOODS_TYPE) return 1;
      return b[1] - a[1];
    })
    .map(([key, count]) => ({
      key,
      label: GOODS_TYPE_LABEL[key] ?? key,
      count,
    }));
}

/**
 * 侧栏分类列表。
 *
 * 只列**当前大类下**的分类——切到「卡密」就只看到那 12 个，切到「权益」
 * 看到 30 个。这样每次面对的都是十几项而不是 42 项，也不用再折叠。
 */
function renderNav(): string {
  if (!catalog) return "";
  // 计数口径必须和列表一致——同时过大类和库存筛选。
  // 只按大类算的话会出现「侧栏写 12、标题写 10」这种对不上的情况。
  let scoped = filterProducts(catalog.items, keyword);
  if (goodsType) scoped = scoped.filter((p) => p.goodsType === goodsType);
  if (stockView === "live") scoped = scoped.filter((p) => !isSoldOut(p));
  else if (stockView === "sold") scoped = scoped.filter(isSoldOut);

  const counts = new Map<string, number>();
  for (const item of scoped) {
    const name = item.category?.trim() || "其他";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    `<button class="nav-item" type="button" data-cat=""
      aria-pressed="${activeCategory === null}">
      <span class="nav-icon" style="background:${ICON_COLORS[0]}">${icons.grid}</span>
      <span class="nav-name">全部</span>
      <span class="nav-count">${scoped.length}</span>
    </button>` +
    cats
      .map(
        ([name, count], i) => `<button class="nav-item" type="button" data-cat="${esc(name)}"
      aria-pressed="${activeCategory === name}">
      <span class="nav-icon" style="background:${ICON_COLORS[(i + 1) % ICON_COLORS.length]}">${esc(initial(name))}</span>
      <span class="nav-name" title="${esc(name)}">${esc(name)}</span>
      <span class="nav-count">${count}</span>
    </button>`,
      )
      .join("")
  );
}

/** 当前筛选条件下可见的商品。 */
function visibleProducts(): Product[] {
  if (!catalog) return [];
  let list = filterProducts(catalog.items, keyword);
  if (goodsType) list = list.filter((p) => p.goodsType === goodsType);
  if (activeCategory) list = list.filter((p) => p.category === activeCategory);
  if (stockView === "live") list = list.filter((p) => !isSoldOut(p));
  else if (stockView === "sold") list = list.filter(isSoldOut);

  if (sortByPrice) {
    // 价格是字符串，得转数字比；解析不出的排最后而不是当 0 排最前
    list = [...list].sort((a, b) => {
      const x = Number(a.price);
      const y = Number(b.price);
      if (!Number.isFinite(x)) return 1;
      if (!Number.isFinite(y)) return -1;
      return x - y;
    });
  }
  return list;
}

/**
 * 只渲染商品列表部分。
 *
 * 和外壳分开是有意的：搜索/筛选时只换这一块，输入框不会被重建，
 * 所以焦点、光标位置都自然保持——不用重绘后再把它们塞回去。
 */
function renderList(): string {
  const visible = visibleProducts();
  if (!visible.length) {
    return `<div class="state">
      <h2>没有匹配的商品</h2>
      <p>换个关键词，或在左侧选「全部商品」。</p>
    </div>`;
  }

  // 已经锁定单个分类时不再按分类分组——只有一组，标题纯属重复。
  if (activeCategory) {
    return `<div class="grid">${visible.map(renderCard).join("")}</div>`;
  }

  return groupByCategory(visible)
    .map(
      (g) => `<section class="group">
  <div class="group-head">
    <h2>${esc(g.name)}</h2>
    <span class="group-count">${g.items.length}</span>
    <span class="rule"></span>
  </div>
  <div class="grid">${g.items.map(renderCard).join("")}</div>
</section>`,
    )
    .join("");
}

/** 更新列表 + 计数 + 各处按下态。 */
function updateView(): void {
  const host = document.querySelector<HTMLDivElement>("#list");
  if (!host || !catalog) return;

  host.innerHTML = renderList();

  const count = visibleProducts().length;
  const tally = document.querySelector<HTMLSpanElement>("#tally");
  if (tally) tally.textContent = `${count} / ${catalog.items.length}`;
  const status = document.querySelector<HTMLDivElement>("#status");
  if (status) status.textContent = `${count} 件商品`;

  const heading = document.querySelector<HTMLHeadingElement>("#heading");
  if (heading) {
    heading.textContent =
      activeCategory ??
      (goodsType ? (GOODS_TYPE_LABEL[goodsType] ?? goodsType) : "商品");
  }
  const headCount = document.querySelector<HTMLSpanElement>("#headCount");
  if (headCount) headCount.textContent = String(count);

  // 只更新真正代表筛选的项——大类按钮是折叠容器，没有 data-cat，
  // 用 aria-expanded 表达状态，不能被当成「全部」误标成选中。
  // 顶部大类：数字随库存口径变，选中态跟 goodsType 走
  const typeCounts = new Map(goodsTypes().map((t) => [t.key, t.count]));
  for (const el of document.querySelectorAll<HTMLButtonElement>(".segment")) {
    const key = el.dataset.type ?? "";
    const n = el.querySelector(".n");
    if (n) n.textContent = String(typeCounts.get(key) ?? 0);
    el.setAttribute("aria-pressed", String(key === goodsType));
  }
  // 库存分段：数字要跟随**当前所有筛选**（大类 + 分类 + 搜索），
  // 只按大类算的话，选了「Claude」右边还显示整个卡密的 68/52/16，对不上。
  let base = filterProducts(catalog.items, keyword);
  if (goodsType) base = base.filter((p) => p.goodsType === goodsType);
  if (activeCategory) base = base.filter((p) => p.category === activeCategory);
  const liveN = base.filter((p) => !isSoldOut(p)).length;
  const stockCounts: Record<string, number> = {
    all: base.length,
    live: liveN,
    sold: base.length - liveN,
  };
  for (const el of document.querySelectorAll<HTMLButtonElement>(".toolbar .chip")) {
    const view = el.dataset.view ?? "all";
    el.setAttribute("aria-pressed", String(view === stockView));
    const b = el.querySelector("b");
    if (b) b.textContent = String(stockCounts[view] ?? 0);
  }

  syncNavSelect();

  for (const el of document.querySelectorAll<HTMLButtonElement>(".nav-item")) {
    if (el.classList.contains("is-section")) continue;
    const value = el.dataset.cat ?? "";
    el.setAttribute(
      "aria-pressed",
      String(value === "" ? activeCategory === null : activeCategory === value),
    );
  }
}

function renderShell(): void {
  if (!catalog) return;

  // 库存计数只统计当前大类——切到卡密还显示全站数字会对不上
  const scoped = goodsType
    ? catalog.items.filter((p) => p.goodsType === goodsType)
    : catalog.items;
  const live = scoped.filter((p) => !isSoldOut(p)).length;
  const sold = scoped.length - live;

  // 侧栏只列**当前大类**下的分类——大类由顶部切换。
  // 用小铺自带的 goods_type（卡密/权益），不自己造分类。
  const navItems = renderNav();

  // 顶部浮岛 = 小铺自带的一级大类（卡密 / 权益），点击切换。
  // 顶部只放真实大类，不放「全部」——「全部」的语义交给侧栏第一项，
  // 那里的「全部」指的是「当前大类下的全部」，语义更准也更好看。
  const typeTabs = goodsTypes()
    .map((t) => ({
      key: t.key,
      label: t.label,
      icon: t.key === "card" ? icons.card : icons.crown,
      n: t.count,
    }))
    .map(
      (t) => `<button class="segment" type="button" data-type="${t.key}"
      aria-pressed="${t.key === goodsType}">${t.icon}${esc(t.label)}
      <span class="n">${t.n}</span></button>`,
    )
    .join("");

  // 库存筛选降级成工具栏里的小分段——它是次级条件，不该和大类抢主位。
  const stockTabs = [
    { view: "all", label: "不限", n: live + sold },
    { view: "live", label: "有货", n: live },
    { view: "sold", label: "售罄", n: sold },
  ]
    .map(
      (s) => `<button class="chip" type="button" data-view="${s.view}"
      aria-pressed="${s.view === stockView}">${s.label}<b>${s.n}</b></button>`,
    )
    .join("");

  app.innerHTML = `<div class="layout">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">${esc(initial(catalog.shopName ?? "商"))}</div>
      <div class="brand-text">
        <strong>${esc(catalog.shopName ?? "商品目录")}</strong>
        <span>共 ${catalog.items.length} 件</span>
      </div>
    </div>
    <div class="nav-label">分类</div>
    <nav id="nav" class="nav-scroll" aria-label="商品分类">${navItems}</nav>
    <!-- 窄屏改用原生下拉：13 个分类横向滚动很难用，原生 select 在手机上
         会拉起系统选择器，一屏看全还能快速定位 -->
    <select id="navSelect" class="nav-select" aria-label="选择分类"></select>
    <div class="sidebar-foot">
      同步于<br>${esc(formatTime(catalog.updatedAt))}
    </div>
  </aside>

  <main class="work">
    <div class="work-head">
      <h1 id="heading">${esc(goodsType ? (GOODS_TYPE_LABEL[goodsType] ?? goodsType) : "商品")}</h1>
      <span class="head-count" id="headCount">${visibleProducts().length}</span>
    </div>

    <div class="segments" role="group" aria-label="按商品大类切换">${typeTabs}</div>

    <div class="toolbar">
      <div class="search">
        ${icons.search}
        <input type="search" id="q" placeholder="搜索商品…" autocomplete="off"
          aria-label="搜索商品" aria-describedby="status">
      </div>
      <div class="chips" role="group" aria-label="按库存筛选">${stockTabs}</div>
      <div class="tools">
        <span class="tally" id="tally">${catalog.items.length} / ${catalog.items.length}</span>
        <button class="icon-btn" type="button" id="clear" aria-label="清空搜索" hidden>${icons.close}</button>
        <button class="icon-btn" type="button" id="sort" aria-label="按价格排序"
          aria-pressed="${sortByPrice}"
          title="${sortByPrice ? "取消价格排序" : "按价格排序"}">${icons.sort}</button>
        <button class="icon-btn" type="button" id="reload" aria-label="重新载入数据"
          title="重新载入">${icons.reload}</button>
      </div>
    </div>

    <div id="status" class="sr-only" role="status" aria-live="polite"></div>
    <div id="list">${renderList()}</div>
  </main>
</div>`;

  bindEvents();
  // 首屏也同步一次，保证顶部/侧栏/标题的数字与选中态一开始就对得上
  updateView();
}

function bindEvents(): void {
  const input = document.querySelector<HTMLInputElement>("#q");
  const clear = document.querySelector<HTMLButtonElement>("#clear");

  if (input && clear) {
    let timer: number | undefined;
    const apply = () => {
      keyword = input.value;
      clear.hidden = !input.value;
      // 侧栏分类计数含搜索口径，要跟着重建
      const nav = document.querySelector<HTMLElement>("#nav");
      if (nav) { nav.innerHTML = renderNav(); bindNav(); }
      updateView();
    };
    input.addEventListener("input", () => {
      clear.hidden = !input.value;
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, 160);
    });
    // Esc 清空是搜索框的通用约定
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && input.value) {
        input.value = "";
        apply();
      }
    });
    clear.addEventListener("click", () => {
      input.value = "";
      apply();
      input.focus();
    });
  }

  bindNav();

  // 顶部大类：切换后重建侧栏（分类列表跟着变），并清掉二级选择
  for (const el of document.querySelectorAll<HTMLButtonElement>(".segment")) {
    el.addEventListener("click", () => {
      goodsType = el.dataset.type ?? null;
      activeCategory = null;
      const nav = document.querySelector<HTMLElement>("#nav");
      if (nav) {
        nav.innerHTML = renderNav();
        bindNav();
      }
      updateView();
    });
  }

  // 库存筛选
  for (const el of document.querySelectorAll<HTMLButtonElement>(".chip")) {
    el.addEventListener("click", () => {
      stockView = (el.dataset.view as StockView) ?? "all";
      // 侧栏计数含库存口径，先重建；其余状态由 updateView 统一同步
      const nav = document.querySelector<HTMLElement>("#nav");
      if (nav) { nav.innerHTML = renderNav(); bindNav(); }
      updateView();
    });
  }

  // 大类：点击展开/收起，不改变筛选——它只是个容器
  for (const el of document.querySelectorAll<HTMLButtonElement>(".is-section")) {
    el.addEventListener("click", () => {
      const open = el.getAttribute("aria-expanded") === "true";
      el.setAttribute("aria-expanded", String(!open));
      const panel = document.querySelector<HTMLDivElement>(`#${el.getAttribute("aria-controls")}`);
      if (panel) panel.hidden = open;
    });
  }

  const sort = document.querySelector<HTMLButtonElement>("#sort");
  sort?.addEventListener("click", () => {
    sortByPrice = !sortByPrice;
    sort.setAttribute("aria-pressed", String(sortByPrice));
    sort.title = sortByPrice ? "取消价格排序" : "按价格排序";
    updateView();
  });

  document
    .querySelector<HTMLButtonElement>("#reload")
    ?.addEventListener("click", () => void boot());
}

/** 同步移动端下拉的选项与选中值——和侧栏用同一份数据。 */
function syncNavSelect(): void {
  const sel = document.querySelector<HTMLSelectElement>("#navSelect");
  if (!sel || !catalog) return;

  let scoped = filterProducts(catalog.items, keyword);
  if (goodsType) scoped = scoped.filter((p) => p.goodsType === goodsType);
  if (stockView === "live") scoped = scoped.filter((p) => !isSoldOut(p));
  else if (stockView === "sold") scoped = scoped.filter(isSoldOut);

  const counts = new Map<string, number>();
  for (const item of scoped) {
    const name = item.category?.trim() || "其他";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  sel.innerHTML =
    `<option value="">全部分类（${scoped.length}）</option>` +
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `<option value="${esc(name)}">${esc(name)}（${n}）</option>`)
      .join("");
  sel.value = activeCategory ?? "";
}

/** 侧栏分类点击——单独抽出来，因为切换大类后侧栏会重建，需要重新绑定。 */
function bindNav(): void {
  const sel = document.querySelector<HTMLSelectElement>("#navSelect");
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = "1"; // 只绑一次——侧栏会重建但下拉不会
    sel.addEventListener("change", () => {
      activeCategory = sel.value || null;
      updateView();
      document.querySelector(".work")?.scrollIntoView({ block: "start" });
    });
  }

  for (const el of document.querySelectorAll<HTMLButtonElement>(".nav-item")) {
    el.addEventListener("click", () => {
      activeCategory = el.dataset.cat || null;
      for (const n of document.querySelectorAll<HTMLButtonElement>(".nav-item")) {
        n.setAttribute("aria-pressed", String((n.dataset.cat || null) === activeCategory));
      }
      updateView();
      document.querySelector(".work")?.scrollIntoView({ block: "start" });
    });
  }
}

async function boot(): Promise<void> {
  renderLoading();
  try {
    catalog = await loadCatalog();
    // 顶部没有「全部」了，进来必须落在某个大类上。
    // 优先卡密——那是主推品类；店里没有卡密时再退回商品最多的那个。
    if (!goodsType) {
      const types = goodsTypes();
      goodsType =
        types.find((t) => t.key === DEFAULT_GOODS_TYPE)?.key ??
        types[0]?.key ??
        null;
    }
    renderShell();
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  }
}

void boot();
