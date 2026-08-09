/**
 * 采集商品 → 产出 products.json。
 *
 * 为什么采集必须在本机跑（2026-08-08 实测）：
 *   ldxp.cn 按出口 IP 判定，境外 IP、机房 IP、公开代理一律弹滑动验证码，
 *   只有本机的国内住宅 IP 直连畅通。cookie 也救不了——acw_tc 绑 IP，
 *   推给服务器就失效。所以采集端只能是你这台机器。
 *
 * 前端（web/）是独立工程，**只部署一次**；之后每次同步只覆盖 products.json，
 * 前端在运行时 fetch 它。所以这个脚本不生成任何 HTML。
 *
 * 用法：
 *   pnpm sync              采集并写入 web/public/products.json
 *   pnpm sync --deploy     采集后连同前端一起发布到 Cloudflare Pages
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { LdxpShopConnector } from "@/lib/connectors/ldxp-shop/connector";
import {
  catSlug,
  productPage,
  categoryPage,
  sitemap,
  type PageProduct,
} from "./lib/static-pages";
import type { NormalizedGoods } from "@/lib/connectors/types";

const SHOP_URL = process.env.SHOP_URL ?? "https://pay.ldxp.cn/shop/miaoli";
const OUT_FILE = process.env.CATALOG_OUT ?? "web/public/products.json";
const CF_PROJECT = process.env.CF_PAGES_PROJECT ?? "miaokit-catalog";
/** 门户站——数据变了它上面的数字和商品条也得跟着变，所以一起发布。 */
const CF_PORTAL = process.env.CF_PORTAL_PROJECT ?? "miaokit-portal";

/** 原始数据里的分类信息，规范化字段没带，得从 raw 里取。 */
function categoryOf(item: NormalizedGoods): string {
  const raw = (item as { raw?: { category?: { name?: string } } }).raw;
  return raw?.category?.name?.trim() || "其他";
}

const IMG_DIR = "web/public/img";

/** 卡片最宽约 300px，2 倍图足够清晰；再大纯属浪费带宽。 */
const IMG_MAX_PX = 640;

/**
 * 就地缩图。
 *
 * 用 macOS 自带的 sips，不引入图像处理依赖——这个脚本只在你本机跑，
 * 没必要为它装一套 sharp/imagemagick。缩不了就保持原样，不影响同步。
 */
function shrink(path: string): void {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  try {
    execFileSync("sips", ["-Z", String(IMG_MAX_PX), path], {
      stdio: "ignore",
      timeout: 15_000,
    });
  } catch {
    /* 缩图失败不致命，原图照样能显示 */
  }
}

/**
 * 转成 WebP。
 *
 * 商品图大多是 PNG，而 PNG 对这类含照片/渐变的内容压缩效率很差
 * （实测 198 张 PNG 占 46MB，转 WebP 后不到三分之一）。
 * 没装 cwebp 就跳过，保留原图。
 *
 * @returns 成功则返回新文件名，失败返回 null
 */
function toWebp(path: string, name: string): string | null {
  if (name.endsWith(".webp") || name.endsWith(".gif")) return null; // GIF 转了会丢动画
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const out = path.replace(/\.[^.]+$/, ".webp");
  try {
    execFileSync("cwebp", ["-quiet", "-q", "82", path, "-o", out], {
      stdio: "ignore",
      timeout: 20_000,
    });
    const { unlinkSync, existsSync } = require("node:fs") as typeof import("node:fs");
    if (!existsSync(out)) return null;
    unlinkSync(path); // 原图删掉，不然两份都在
    return name.replace(/\.[^.]+$/, ".webp");
  } catch {
    return null;
  }
}

/**
 * 把商品图下载到本地，返回站内相对路径。
 *
 * 为什么必须下载：权益类商品的图在 www.ldxp.cn，那个域**对浏览器请求返回 403**
 * （防盗链，认 Referer/Sec-Fetch 头），所以前端直接引用会全部裂图
 * （Chrome 报 ERR_BLOCKED_BY_ORB）。下到本地后是同源资源，不受影响。
 *
 * 服务端下载没这个问题——本机 IP 干净，且不带浏览器特征头。
 *
 * 已存在的文件跳过，所以日常同步只下新增的图。
 */
async function localizeImages(
  items: Array<{ externalId: string; imageUrl: string | null }>,
): Promise<Map<string, string>> {
  const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(IMG_DIR, { recursive: true });

  const mapping = new Map<string, string>();
  let downloaded = 0;
  let reused = 0;
  let failed = 0;

  for (const item of items) {
    if (!item.imageUrl) continue;
    // 用商品 ID 命名，稳定且不会因为源地址变化而重复下载
    const ext = (item.imageUrl.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)?.[1] ?? "jpg").toLowerCase();
    const name = `${item.externalId}.${ext}`;
    const path = `${IMG_DIR}/${name}`;

    // 转过 WebP 的扩展名变了，两个都要认，否则每次同步都重下
    const webpName = name.replace(/\.[^.]+$/, ".webp");
    if (existsSync(`${IMG_DIR}/${webpName}`)) {
      mapping.set(item.externalId, `/img/${webpName}`);
      reused += 1;
      continue;
    }
    if (existsSync(path)) {
      mapping.set(item.externalId, `/img/${name}`);
      reused += 1;
      continue;
    }

    try {
      const response = await fetch(item.imageUrl, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      // 拿到 HTML 说明被防盗链挡了，别把错误页当图片存下来
      if (buffer.subarray(0, 20).toString("utf8").trimStart().startsWith("<")) {
        throw new Error("返回的是 HTML，不是图片");
      }
      writeFileSync(path, buffer);
      shrink(path); // 源图常有 2048×2048，卡片只显示 240px，不压就是几十倍浪费
      const converted = toWebp(path, name);
      mapping.set(item.externalId, `/img/${converted ?? name}`);
      downloaded += 1;
    } catch {
      failed += 1; // 下不下来就保留原地址，至少还有机会显示
    }
  }

  console.log(
    `  图片：新下载 ${downloaded} · 复用 ${reused} · 失败 ${failed}`,
  );
  return mapping;
}

/** 本次同步的成果，结束时写进状态文件供 `pnpm schedule` 展示。 */
let lastResult: Record<string, unknown> = {};

async function main() {
  const deploy = process.argv.includes("--deploy");

  // 随机抖动：定时器固定 5 分钟触发，这里再随机等 0-5 分钟，
  // 实际间隔落在 5-10 分钟。避免每次都在整点同一秒打货源平台。
  // 手动跑（pnpm sync）不抖动，等着看结果的时候没必要干等。
  const jitterMax = Number(process.env.SYNC_JITTER_MAX_MS ?? 0);
  if (jitterMax > 0) {
    const wait = Math.floor(Math.random() * jitterMax);
    console.log(`随机延迟 ${Math.round(wait / 1000)} 秒后开始…`);
    await new Promise((r) => setTimeout(r, wait));
  }

  console.log(`采集 ${SHOP_URL}`);
  const connector = new LdxpShopConnector({ baseUrl: SHOP_URL });

  const shopName = await connector.getShopName();
  const { items } = await connector.listAll({ page: 1, pageSize: 100 });

  if (!items.length) {
    // 空结果多半是被 WAF 拦了。这时候写文件会把线上好数据覆盖成空站，
    // 所以宁可失败退出，让线上保持上一次的好数据。
    console.error("✗ 一个商品都没采到，不写文件（避免把线上覆盖成空）。");
    process.exit(1);
  }

  // 只保留前端要用的字段：JSON 每次同步都要传，不带无用数据。
  // 尤其 description 含大段 HTML，218 件能占好几百 KB。
  const entries = items.map((item) => ({
      externalId: item.externalId,
      title: item.title,
      imageUrl: item.imageUrl ?? null,
      price: item.price ?? null,
      stockCount: item.stockCount ?? null,
      availabilityHint: item.availabilityHint,
      url: item.url,
      category: categoryOf(item),
      // 小铺自带的一级大类：card=卡密、equity=权益。
      // 前端顶部用它切换，不要自己再造一套分类。
      goodsType: item.goodsType,
  }));

  // 把商品图抓到本地——权益类的图在 www.ldxp.cn，那个域对浏览器返回 403
  console.log("下载商品图…");
  const localImages = await localizeImages(entries);

  const catalog = {
    shopName,
    updatedAt: new Date().toISOString(),
    items: entries.map((e) => ({
      ...e,
      imageUrl: localImages.get(e.externalId) ?? e.imageUrl,
    })),
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(catalog), "utf8");

  const kb = Math.round(JSON.stringify(catalog).length / 1024);
  const sold = catalog.items.filter(
    (i) => i.availabilityHint === "OUT_OF_STOCK",
  ).length;
  const categories = new Set(catalog.items.map((i) => i.category)).size;

  lastResult = {
    items: catalog.items.length,
    sold,
    categories,
    sizeKb: kb,
  };

  console.log(
    `✓ ${catalog.items.length} 件商品（${sold} 件售罄）· ${categories} 个分类 · ${kb}KB → ${OUT_FILE}`,
  );

  if (!deploy) {
    console.log("");
    console.log("本地预览：  pnpm --dir web dev");
    console.log("发布上线：  pnpm sync --deploy");
    return;
  }

  const { execSync } = await import("node:child_process");
  const { existsSync, copyFileSync } = await import("node:fs");

  // 前端产物已存在就不重新构建——日常同步只是数据变了，前端代码没动，
  // 重新构建纯属浪费。改了 web/ 下的代码时加 --rebuild 强制重建。
  const needBuild =
    process.argv.includes("--rebuild") || !existsSync("web/dist/index.html");

  if (needBuild) {
    console.log("构建前端…");
    execSync("pnpm --dir web build", { stdio: "inherit" });
  } else {
    // 只把新数据放进已有产物里，其余文件原样复用（wrangler 会跳过未变的）
    copyFileSync(OUT_FILE, "web/dist/products.json");
    // 图片也要同步过去——新商品的图不在旧产物里
    const { cpSync } = await import("node:fs");
    cpSync(IMG_DIR, "web/dist/img", { recursive: true, force: true });
    console.log("复用已有前端产物，更新 products.json 与图片");
  }

  // 预渲染首页 + 为每件商品/每个分类生成独立静态页。
  // 不做的话所有路径返回同一份 HTML，Google 判定重复内容，
  // 215 件商品最多只能收录 1 个页面（2026-08-09 SEO 诊断结论）。
  prerender("web/dist/index.html", catalog.items, catalog.shopName);
  buildStaticPages("web/dist", catalog.items);

  console.log(`发布商品站（${CF_PROJECT}）…`);
  execSync(
    `npx wrangler pages deploy web/dist --project-name=${CF_PROJECT} --commit-dirty=true`,
    { stdio: "inherit" },
  );

  // 门户也要重发：它在运行时 fetch 商品数据，上下架后页面上的
  // 「196 件在售」和商品条会跟着变。不重发的话 CDN 上还是旧的 HTML/JS，
  // 虽然数据是新的，但缓存的静态资源可能对不上。
  await deployPortal();
}

/**
 * 发布门户站。
 *
 * 门户没有自己的数据文件——它运行时去商品站拉 products.json，
 * 所以这里只需要构建 + 发布，不用管数据。
 * 门户目录不存在（比如别人 clone 了只跑采集）就跳过，不该让同步失败。
 */
/**
 * 首页预渲染。
 *
 * 两个关键点（2026-08-09 复测结论）：
 *
 * 1. 内容必须放在**正常 DOM** 里，不能塞进 `<noscript>`。
 *    降级内容不算正式内容——H1 藏在 noscript 里等于没有 H1。
 *    前端启动后会用 innerHTML 覆盖 #app，所以对真人不会重复显示。
 *
 * 2. head 里的 title / description / canonical / og 也要一起补。
 *    原来 title 是「商品目录」4 个字，既没品牌词也没品类词。
 */
function prerender(
  htmlPath: string,
  items: Array<{
    externalId: string;
    title: string;
    price: string | null;
    url: string;
    category: string;
    stockCount: number | null;
    availabilityHint: string;
  }>,
  shopName: string | null,
): void {
  const { readFileSync, writeFileSync, existsSync } =
    require("node:fs") as typeof import("node:fs");
  if (!existsSync(htmlPath)) return;

  const e = (t: unknown) =>
    String(t ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const ORIGIN = "https://shop.miaokit.cloud";
  const live = items.filter((i) => i.availabilityHint !== "OUT_OF_STOCK");
  const prices = live
    .map((i) => Number(i.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  const min = prices.length ? Math.min(...prices) : 0;

  // 分类聚合，首页要有指向分类页的内链——爬虫靠链接爬行
  const byCat = new Map<string, number>();
  for (const i of items) {
    const n = i.category?.trim() || "其他";
    byCat.set(n, (byCat.get(n) ?? 0) + 1);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

  const title =
    `AI 工具与数字权益商品目录 — ChatGPT Plus、Claude、Gemini | ${shopName ?? "miaokit"}`;
  const description =
    `共 ${live.length} 件在售${min ? `，最低 ¥${min.toFixed(2)}` : ""}。` +
    `提供 ChatGPT Plus、Claude、Gemini、GROK 等 AI 工具账号，` +
    `以及视频会员、网盘、生活服务等数字权益。官方渠道直充与成品号，` +
    `自动发货，价格与库存每 5 分钟自动同步。`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: `${ORIGIN}/`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: live.length,
      itemListElement: live.slice(0, 20).map((i, n) => ({
        "@type": "ListItem",
        position: n + 1,
        url: `${ORIGIN}/p/${i.externalId}/`,
        item: {
          "@type": "Product",
          name: i.title,
          category: i.category,
          offers: {
            "@type": "Offer",
            price: i.price ?? "0",
            priceCurrency: "CNY",
            availability: "https://schema.org/InStock",
          },
        },
      })),
    },
  };

  // head 元数据
  const head = `<link rel="canonical" href="${ORIGIN}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${ORIGIN}/">
<meta property="og:site_name" content="miaokit">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

  // 正文——放在 #app 里，前端启动后会覆盖它
  const body = `<div class="ssr">
<h1>AI 工具与数字权益商品目录</h1>
<p>共 ${live.length} 件在售${min ? `，最低 ¥${min.toFixed(2)}` : ""}。提供 ChatGPT Plus 会员、Claude、Gemini、GROK 等
主流 AI 工具的账号与充值，也有视频会员、网盘会员、生活服务券等数字权益。
所有商品走官方渠道直充或成品号交付，下单后自动发货。价格和库存每 5 分钟从货源自动同步，
页面上看到的就是当前价。</p>
<h2>商品分类</h2>
<ul>${cats
    .map(
      ([name, n], i) =>
        `<li><a href="/c/${catSlug(name, i)}/">${e(name)}</a>（${n} 件）</li>`,
    )
    .join("")}</ul>
<h2>部分在售商品</h2>
<ul>${live
    .slice(0, 40)
    .map(
      (i) =>
        `<li><a href="/p/${e(i.externalId)}/">${e(i.title)}</a> — ${e(i.category)} ¥${e(i.price)}</li>`,
    )
    .join("")}</ul>
</div>`;

  let html = readFileSync(htmlPath, "utf8");
  if (html.includes('rel="canonical"')) return; // 已注入过

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${e(title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${e(description)}">`,
    )
    .replace("</head>", `${head}\n</head>`)
    .replace('<div id="app"></div>', `<div id="app">${body}</div>`);

  writeFileSync(htmlPath, html, "utf8");
}

/**
 * 生成商品页、分类页、sitemap、robots。
 *
 * 每页独立 URL + 独立 title/description + canonical + Product 结构化数据，
 * 这是「商品能被收录」的前提。页面之间有面包屑和同类推荐互链，
 * 让爬虫能顺着爬完整站。
 */
function buildStaticPages(dir: string, items: PageProduct[]): void {
  const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");

  // 分类归组
  const byCat = new Map<string, PageProduct[]>();
  for (const item of items) {
    const name = item.category?.trim() || "其他";
    const list = byCat.get(name);
    if (list) list.push(item);
    else byCat.set(name, [item]);
  }
  const cats = [...byCat.entries()].map(([name, list], i) => ({
    name,
    slug: catSlug(name, i),
    items: list,
  }));
  const slugOf = new Map(cats.map((c) => [c.name, c.slug]));

  // 商品页
  for (const item of items) {
    const slug = slugOf.get(item.category?.trim() || "其他") ?? "other";
    const siblings = (byCat.get(item.category?.trim() || "其他") ?? [])
      .filter((p) => p.externalId !== item.externalId)
      .slice(0, 8);
    const out = `${dir}/p/${item.externalId}`;
    mkdirSync(out, { recursive: true });
    writeFileSync(
      `${out}/index.html`,
      productPage(item, siblings, `/c/${slug}/`),
      "utf8",
    );
  }

  // 分类页
  for (const c of cats) {
    const out = `${dir}/c/${c.slug}`;
    mkdirSync(out, { recursive: true });
    writeFileSync(
      `${out}/index.html`,
      categoryPage(c.name, c.slug, c.items),
      "utf8",
    );
  }

  writeFileSync(`${dir}/sitemap.xml`, sitemap(items, cats), "utf8");
  writeFileSync(
    `${dir}/robots.txt`,
    "User-agent: *\nAllow: /\nSitemap: https://shop.miaokit.cloud/sitemap.xml\n",
    "utf8",
  );

  console.log(`  静态页：${items.length} 个商品页 · ${cats.length} 个分类页`);
}

/** robots.txt 与 sitemap.xml——没有这两个文件，搜索引擎不知道该收录什么。 */
function writeSeoFiles(dir: string, origin: string): void {
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    `${dir}/robots.txt`,
    `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
    "utf8",
  );
  writeFileSync(
    `${dir}/sitemap.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>https://shop.miaokit.cloud/</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>0.9</priority></url>
  <url><loc>https://convert.miaokit.cloud/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>
</urlset>\n`,
    "utf8",
  );
}

async function deployPortal(): Promise<void> {
  const { execSync } = await import("node:child_process");
  const { existsSync } = await import("node:fs");
  if (!existsSync("portal/package.json")) return;

  try {
    if (!existsSync("portal/node_modules")) {
      console.log("门户首次构建，安装依赖…");
      execSync("pnpm --dir portal install", { stdio: "inherit" });
    }
    console.log(`发布门户站（${CF_PORTAL}）…`);
    execSync("pnpm --dir portal build", { stdio: "inherit" });
    writeSeoFiles("portal/dist", "https://miaokit.cloud");
    execSync(
      `npx wrangler pages deploy portal/dist --project-name=${CF_PORTAL} --commit-dirty=true`,
      { stdio: "inherit" },
    );
  } catch (error) {
    // 门户发布失败不该让整次同步算失败——商品站才是主线
    console.warn(
      "⚠ 门户发布失败（商品站已更新）：",
      error instanceof Error ? error.message.slice(0, 120) : String(error),
    );
  }
}

/** 连续失败几次才通知——偶发网络抖动不值得打扰。 */
const ALERT_AFTER = 2;

/**
 * 失败时发 macOS 通知。
 *
 * 定时任务在后台跑，失败了不会有任何动静：日志里有、状态文件里有，
 * 但你不主动查就发现不了，可能几天后才注意到数据早就停更了。
 *
 * 只在**连续**失败到阈值时响一次，之后保持沉默直到恢复——
 * 每轮都弹会变成噪音，反而让人忽略。恢复时也通知一次，形成闭环。
 */
function notify(title: string, message: string): void {
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    // 用 osascript 而不是第三方库：系统自带，零依赖
    execFileSync(
      "osascript",
      ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`],
      { stdio: "ignore", timeout: 8_000 },
    );
  } catch {
    /* 通知发不出去不该影响同步本身 */
  }
}

/**
 * 把错误翻译成「你该做什么」。
 *
 * 告警只报错误原文没用——看到 "authentication failed" 不一定知道
 * 是 Cloudflare 登录过期、该重新授权。这里把常见故障映射成具体动作。
 */
function actionHint(message: string): string {
  const m = message.toLowerCase();
  if (/oauth|unauthorized|authentication|10000|expired|invalid token/.test(m)) {
    return "Cloudflare 登录过期，跑一次 wrangler login 重新授权";
  }
  if (/挑战页|forbidden|滑动验证|waf/.test(message)) {
    return "货源平台拦截了请求，多半是出口 IP 变了";
  }
  if (/店铺链接不存在|无法从地址解析/.test(message)) {
    return "店铺地址不对，检查 SHOP_URL";
  }
  if (/timeout|etimedout|econnreset|network|fetch failed/.test(m)) {
    return "网络不通，通常自己会恢复";
  }
  return message.slice(0, 70);
}

/** 读上一次的状态，用于判断「连续失败几次」和「是否刚恢复」。 */
function readState(): { ok?: boolean; failStreak?: number } {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return JSON.parse(readFileSync("data/sync-state.json", "utf8"));
  } catch {
    return {};
  }
}

/**
 * 记录本次同步结果，供 `pnpm schedule` 查看状态。
 *
 * 定时任务在后台跑，出错时你不会看到终端输出——状态落盘才能事后知道
 * 上次是成功还是失败、失败在哪。
 */
function writeState(state: Record<string, unknown>): void {
  try {
    mkdirSync("data", { recursive: true });
    writeFileSync(
      "data/sync-state.json",
      JSON.stringify({ at: new Date().toISOString(), ...state }),
      "utf8",
    );
  } catch {
    /* 状态写不下不该让同步本身失败 */
  }
}

main()
  .then(() => {
    const prev = readState();
    writeState({ ok: true, failStreak: 0, ...lastResult });
    // 之前告警过，现在好了——补一条恢复通知，否则你不知道要不要继续管
    if ((prev.failStreak ?? 0) >= ALERT_AFTER) {
      notify("商品同步已恢复", `${lastResult.items ?? "?"} 件商品，同步正常`);
    }
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const streak = (readState().failStreak ?? 0) + 1;
    console.error(`✗ 失败（连续第 ${streak} 次）：`, message);
    writeState({ ok: false, failStreak: streak, error: message });
    // 只在刚达到阈值时响一次，之后沉默，避免每轮都弹变成噪音
    if (streak === ALERT_AFTER) {
      notify(`商品同步失败 ${streak} 次`, actionHint(message));
    }
    process.exit(1);
  });
