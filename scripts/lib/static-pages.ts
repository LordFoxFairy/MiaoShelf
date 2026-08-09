/**
 * 为每个商品和分类生成独立静态页。
 *
 * 为什么必须做（2026-08-09 SEO 诊断结论）：
 * 之前所有路径都返回同一份 HTML——`/`、`/product/xxx`、`/category/gpt`
 * 字节数和标题完全一样。Google 判定为重复内容，**215 件商品最多只收录 1 个页面**。
 * 目录类站点商品页收不进去，SEO 等于没做。
 *
 * 修复：每页有独立 URL、独立 title/description、独立正文、独立 canonical，
 * 并带 Product/Offer 结构化数据（搜索结果能直接显示价格和库存状态）。
 */

export interface PageProduct {
  externalId: string;
  title: string;
  imageUrl: string | null;
  price: string | null;
  stockCount: number | null;
  availabilityHint: string;
  url: string;
  category: string;
  goodsType: string;
}

const ORIGIN = "https://shop.miaokit.cloud";

export function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 分类名转 URL 片段——中文分类名不能直接进路径。 */
export function catSlug(name: string, index: number): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  // 纯中文分类会被清空，退回序号——保证稳定且唯一
  return ascii || `c${index}`;
}

function isLive(p: PageProduct): boolean {
  return p.availabilityHint !== "OUT_OF_STOCK";
}

/** 库存文案，同时用于正文和结构化数据。 */
function stockText(p: PageProduct): string {
  if (!isLive(p)) return "暂时售罄";
  if (p.stockCount === null) return "有货";
  return `库存 ${p.stockCount} 件`;
}

interface ShellOptions {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  body: string;
  jsonLd?: object;
  /** 面包屑，越具体的页面越需要——也是给爬虫的内链。 */
  crumbs?: Array<{ name: string; href: string }>;
}

/**
 * 页面骨架。
 *
 * 注意这些页面是**给爬虫和直接访问者看的静态版本**，内容与主应用一致。
 * 主应用（/）仍是交互式的；这里生成的是可被独立收录的镜像页。
 */
function shell(o: ShellOptions): string {
  const crumbs = o.crumbs?.length
    ? `<nav class="crumbs" aria-label="面包屑">${o.crumbs
        .map((c) => `<a href="${esc(c.href)}">${esc(c.name)}</a>`)
        .join('<span aria-hidden="true">›</span>')}</nav>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.canonical)}">
<meta name="color-scheme" content="light">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.canonical)}">
<meta property="og:site_name" content="miaokit">
<meta name="twitter:card" content="summary">
${o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd)}</script>` : ""}
<style>
:root{--ink:#1a1d26;--soft:#4b5565;--muted:#98a2b3;--line:#e2e7ee;--brand:#3b6ef5;--live:#16a34a;--gone:#e5484d}
*{box-sizing:border-box}
body{margin:0;background:#fafbfc;color:var(--ink);
 font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:28px 20px 64px}
.crumbs{font-size:13px;color:var(--muted);margin-bottom:22px}
.crumbs a{color:var(--soft);text-decoration:none}
.crumbs a:hover{color:var(--brand)}
.crumbs span{margin:0 8px;opacity:.5}
h1{font-size:25px;line-height:1.35;margin:0 0 14px;letter-spacing:-.02em}
h2{font-size:17px;margin:32px 0 12px}
.meta{display:flex;flex-wrap:wrap;gap:18px;align-items:baseline;margin-bottom:22px}
.price{font-size:27px;font-weight:700;color:var(--ink)}
.stock{font-size:14px;color:var(--live)}
.stock.out{color:var(--gone)}
.cta{display:inline-block;padding:13px 26px;border-radius:11px;background:var(--brand);
 color:#fff;text-decoration:none;font-weight:600;margin:6px 0 26px}
.cta:hover{background:#2c5ce8}
.desc{color:var(--soft);margin-bottom:26px}
ul.list{list-style:none;padding:0;margin:0;display:grid;gap:9px}
ul.list li{padding:13px 15px;background:#fff;border:1px solid var(--line);border-radius:11px}
ul.list a{color:var(--ink);text-decoration:none;font-weight:500}
ul.list a:hover{color:var(--brand)}
ul.list .p{color:var(--live);font-weight:600;margin-left:8px}
ul.list .s{color:var(--muted);font-size:13px;margin-left:8px}
footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--line);
 color:var(--muted);font-size:13px}
footer a{color:var(--soft);text-decoration:none;margin-right:14px}
</style>
</head>
<body>
<div class="wrap">
${crumbs}
<h1>${esc(o.h1)}</h1>
${o.body}
<footer>
  <a href="/">全部商品</a>
  <a href="https://miaokit.cloud">miaokit 主页</a>
  <span>价格与库存每 5 分钟自动同步</span>
</footer>
</div>
</body>
</html>`;
}

/** 单个商品页。 */
export function productPage(
  p: PageProduct,
  related: PageProduct[],
  catHref: string,
): string {
  const live = isLive(p);
  const price = p.price ? `¥${p.price}` : "—";
  const canonical = `${ORIGIN}/p/${p.externalId}/`;

  // description 要写满 80-150 字，搜索结果摘要才展示得充分
  const description =
    `${p.title}，${p.category}分类，当前${stockText(p)}，售价 ${price}。` +
    `miaokit 提供 ChatGPT Plus、Claude、Gemini 等 AI 工具与数字权益，` +
    `官方渠道直充与成品号，自动发货，价格与库存每 5 分钟自动同步。`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    category: p.category,
    ...(p.imageUrl
      ? { image: p.imageUrl.startsWith("/") ? ORIGIN + p.imageUrl : p.imageUrl }
      : {}),
    offers: {
      "@type": "Offer",
      price: p.price ?? "0",
      priceCurrency: "CNY",
      availability: live
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: p.url,
      seller: { "@type": "Organization", name: "miaokit" },
    },
  };

  const relatedList = related.length
    ? `<h2>同类商品</h2><ul class="list">${related
        .map(
          (r) =>
            `<li><a href="/p/${esc(r.externalId)}/">${esc(r.title)}</a>` +
            `<span class="p">¥${esc(r.price)}</span>` +
            `<span class="s">${esc(stockText(r))}</span></li>`,
        )
        .join("")}</ul>`
    : "";

  return shell({
    title: `${p.title} — ${stockText(p)} ${price} | miaokit`,
    description,
    canonical,
    h1: p.title,
    jsonLd,
    crumbs: [
      { name: "全部商品", href: "/" },
      { name: p.category, href: catHref },
    ],
    body: `
<div class="meta">
  <span class="price">${esc(price)}</span>
  <span class="stock${live ? "" : " out"}">${esc(stockText(p))}</span>
</div>
<a class="cta" href="${esc(p.url)}" rel="noopener">${live ? "去下单" : "查看详情"}</a>
<p class="desc">
  ${esc(p.title)}，属于 <a href="${esc(catHref)}">${esc(p.category)}</a> 分类。
  ${live ? `当前${esc(stockText(p))}，` : ""}官方渠道，自动发货。
  价格与库存每 5 分钟自动同步，页面上显示的就是当前价。
</p>
${relatedList}`,
  });
}

/** 分类页。 */
export function categoryPage(
  name: string,
  slug: string,
  items: PageProduct[],
): string {
  const live = items.filter(isLive);
  const prices = live
    .map((p) => Number(p.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  const min = prices.length ? Math.min(...prices) : 0;
  const canonical = `${ORIGIN}/c/${slug}/`;

  const description =
    `${name}分类共 ${items.length} 件商品，${live.length} 件在售` +
    (min ? `，最低 ¥${min.toFixed(2)}` : "") +
    `。miaokit 提供 ChatGPT Plus、Claude、Gemini 等 AI 工具与数字权益，` +
    `官方渠道直充与成品号，自动发货，价格库存每 5 分钟同步。`;

  return shell({
    title: `${name} — ${live.length} 件在售${min ? ` ¥${min.toFixed(2)} 起` : ""} | miaokit`,
    description,
    canonical,
    h1: `${name} 商品列表`,
    crumbs: [{ name: "全部商品", href: "/" }],
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${name} 商品列表`,
      description,
      url: canonical,
    },
    body: `
<p class="desc">
  共 ${items.length} 件，其中 ${live.length} 件在售${min ? `，最低 ¥${min.toFixed(2)}` : ""}。
  官方渠道，自动发货，价格与库存每 5 分钟自动同步。
</p>
<ul class="list">${items
      .map(
        (p) =>
          `<li><a href="/p/${esc(p.externalId)}/">${esc(p.title)}</a>` +
          `<span class="p">¥${esc(p.price)}</span>` +
          `<span class="s">${esc(stockText(p))}</span></li>`,
      )
      .join("")}</ul>`,
  });
}

/** sitemap：列出所有页面，Google 才知道这些地址存在。 */
export function sitemap(
  products: PageProduct[],
  cats: Array<{ slug: string }>,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc: string, priority: string, freq = "daily") =>
    `  <url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url(`${ORIGIN}/`, "1.0", "hourly")}
${cats.map((c) => url(`${ORIGIN}/c/${c.slug}/`, "0.8")).join("\n")}
${products.map((p) => url(`${ORIGIN}/p/${p.externalId}/`, "0.6")).join("\n")}
</urlset>
`;
}
