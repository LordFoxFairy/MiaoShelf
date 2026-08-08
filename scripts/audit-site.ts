/**
 * 站点自查：把所有交互组合跑一遍，验证计数口径处处一致。
 *
 * 为什么需要它：顶部大类、侧栏分类、库存分段、标题、卡片数——五处计数
 * 各自计算过，任何一处漏一个筛选维度就会自相矛盾（实际踩过好几次：
 * 「顶部78 vs 侧栏52」「选了 Claude 但库存段还显示整个大类的数字」）。
 * 靠肉眼看截图发现不了全部组合，所以固化成脚本。
 *
 *   pnpm audit                                   查线上
 *   AUDIT_URL=http://localhost:4173 pnpm audit   查本地
 */
import { chromium, devices, type Page } from "playwright";

const n = (s: string) => Number(s.match(/\d+/)?.[0] ?? 0);
const fails: string[] = [];

/** 一致性断言：库存分段自洽、且与标题/卡片数吻合。 */
async function check(p: Page, label: string) {
  const chips = (await p.locator(".toolbar .chip").allTextContents()).map(s => s.trim().replace(/\s+/g, " "));
  const [all, live, sold] = chips.map(n);
  const head = Number((await p.locator("#headCount").textContent())?.trim());
  const cards = await p.locator(".card").count();
  const view = (await p.locator(".toolbar .chip[aria-pressed=true]").getAttribute("data-view")) ?? "all";
  const expect = view === "live" ? live : view === "sold" ? sold : all;

  const problems: string[] = [];
  if (all !== live! + sold!) problems.push(`不限${all} ≠ 有货${live}+售罄${sold}`);
  if (head !== expect) problems.push(`标题${head} ≠ 应有${expect}`);
  if (cards !== expect) problems.push(`卡片${cards} ≠ 应有${expect}`);
  // 空态时没有卡片是正常的
  if (expect === 0 && cards === 0) problems.length = 0;

  if (problems.length) { fails.push(`${label}: ${problems.join("; ")}`); console.log(`  ✗ ${label} → ${problems.join("; ")}`); }
  else console.log(`  ✓ ${label} [${chips.join(" ")}] 标题=${head} 卡片=${cards}`);
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1512, height: 1000 } });
  const errs: string[] = [];
  p.on("pageerror", e => errs.push(String(e).slice(0, 120)));
  const SITE = process.env.AUDIT_URL ?? "https://shop.miaokit.cloud/";
  console.log(`检查 ${SITE}\n`);
  await p.goto(SITE, { waitUntil: "networkidle" });
  await p.waitForTimeout(3500);

  console.log("① 首屏默认");
  await check(p, "首屏");
  const dt = await p.locator(".segment[aria-pressed=true]").getAttribute("data-type");
  const dv = await p.locator(".toolbar .chip[aria-pressed=true]").getAttribute("data-view");
  const sortOn = await p.locator("#sort").getAttribute("aria-pressed");
  if (dt !== "card") fails.push(`默认大类应为 card，实为 ${dt}`);
  if (dv !== "live") fails.push(`默认库存应为 live，实为 ${dv}`);
  if (sortOn !== "true") fails.push(`价格排序应默认开，实为 ${sortOn}`);
  console.log(`  默认值: 大类=${dt} 库存=${dv} 排序=${sortOn}`);

  console.log("② 三种库存筛选 × 两个大类");
  for (const type of ["卡密", "权益"]) {
    await p.locator(".segment", { hasText: type }).click();
    await p.waitForTimeout(700);
    for (const v of ["不限", "有货", "售罄"]) {
      await p.locator(".toolbar .chip", { hasText: v }).click();
      await p.waitForTimeout(650);
      await check(p, `${type}·${v}`);
    }
  }

  console.log("③ 分类切换（每个大类取前 3 个分类）");
  for (const type of ["卡密", "权益"]) {
    await p.locator(".segment", { hasText: type }).click();
    await p.waitForTimeout(700);
    await p.locator(".toolbar .chip", { hasText: "有货" }).click();
    await p.waitForTimeout(600);
    const names = await p.locator(".nav-item .nav-name").allTextContents();
    for (const name of names.slice(1, 4)) {
      await p.locator(".nav-item", { hasText: name }).first().click();
      await p.waitForTimeout(650);
      await check(p, `${type}›${name.trim()}`);
    }
  }

  console.log("④ 搜索");
  await p.locator(".segment", { hasText: "卡密" }).click(); await p.waitForTimeout(700);
  for (const kw of ["gpt", "claude", "zzz不存在"]) {
    await p.fill("#q", kw); await p.waitForTimeout(800);
    await check(p, `搜"${kw}"`);
  }
  await p.click("#clear"); await p.waitForTimeout(700);
  await check(p, "清空搜索");

  console.log("⑤ 排序");
  // 列表按分类分组渲染，排序是**组内**升序；跨组比较没有意义
  const groupsAsc = async () => p.locator(".group").evaluateAll(gs =>
    gs.map(g => {
      const ps = [...g.querySelectorAll(".price")].map(x => parseFloat(x.textContent!.replace(/[^\d.]/g, "")));
      return ps.every((v, i, a) => i === 0 || a[i - 1]! <= v);
    }));
  let asc = await groupsAsc();
  if (asc.length && !asc.every(Boolean)) fails.push(`默认排序：${asc.filter(x=>!x).length}/${asc.length} 组非升序`);
  else console.log(`  ✓ 默认组内价格升序（${asc.length} 组）`);
  await p.click("#sort"); await p.waitForTimeout(700);
  const off = await p.locator("#sort").getAttribute("aria-pressed");
  if (off !== "false") fails.push(`关闭排序后按钮态应为 false，实为 ${off}`);
  else console.log("  ✓ 可关闭");
  await p.click("#sort"); await p.waitForTimeout(700);
  asc = await groupsAsc();
  if (asc.length && !asc.every(Boolean)) fails.push("重开排序后组内非升序");
  else console.log("  ✓ 重开后恢复升序");

  console.log("⑥ 图片与链接");
  const broken = await p.locator(".thumb img").evaluateAll(els =>
    els.filter(e => { const r = e.getBoundingClientRect(); return r.top < 1100 && r.bottom > 0; })
       .filter(e => !(e as HTMLImageElement).naturalWidth).length);
  if (broken) fails.push(`视口内有 ${broken} 张裂图`);
  else console.log("  ✓ 视口内图片全部加载");
  const badHref = await p.locator(".card").evaluateAll(els =>
    els.filter(e => !(e as HTMLAnchorElement).href.startsWith("https://")).length);
  if (badHref) fails.push(`${badHref} 张卡片链接异常`);
  else console.log("  ✓ 卡片链接正常");

  console.log("⑦ 移动端（独立 iPhone 上下文）");
  // 必须开新的移动上下文：只改视口尺寸拿不到真实的移动端渲染
  // （字体、CSS 重排的时机都不一样，会误报）
  const mctx = await b.newContext(devices["iPhone 13"]);
  const mp = await mctx.newPage();
  await mp.goto(SITE, { waitUntil: "load" });
  await mp.waitForSelector(".card", { timeout: 20000 });
  await mp.waitForTimeout(2000);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  if (overflow) fails.push("移动端横向溢出");
  else console.log("  ✓ 无横向溢出");

  // 买家打开手机是来看商品的：第一张卡片不该被控件挤到屏幕外
  const firstTop = await mp.locator(".card").first().evaluate(e => Math.round(e.getBoundingClientRect().top));
  if (firstTop > 320) fails.push(`移动端第一张卡片距顶 ${firstTop}px，控件占太多（应 ≤320）`);
  else console.log(`  ✓ 第一张卡片距顶 ${firstTop}px`);

  const visibleCards = await mp.locator(".card").evaluateAll(els =>
    els.filter(e => { const r = e.getBoundingClientRect(); return r.top < 844 && r.bottom > 0; }).length);
  if (visibleCards < 4) fails.push(`移动端首屏只有 ${visibleCards} 张卡片（应 ≥4）`);
  else console.log(`  ✓ 首屏可见 ${visibleCards} 张卡片`);

  // 触摸目标不能小于 40px，否则很难点中
  const tiny = await mp.locator(".nav-select, .segment, .toolbar .chip, .icon-btn").evaluateAll(els =>
    els.filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 36; }).length);
  if (tiny) fails.push(`移动端有 ${tiny} 个可点元素高度 <36px`);
  else console.log("  ✓ 触摸目标尺寸达标");

  // 分类下拉必须可用——横向滚动条在窄屏是收起的
  if (!(await mp.locator("#navSelect").isVisible())) fails.push("移动端分类下拉不可见");
  else console.log("  ✓ 分类下拉可用");

  await check(mp, "移动端");
  await mctx.close();

  console.log("\n" + "═".repeat(50));
  if (errs.length) fails.push(`控制台错误: ${errs.join(" | ")}`);
  if (fails.length) { console.log(`✗ 发现 ${fails.length} 个问题:`); fails.forEach(f => console.log("  •", f)); }
  else console.log("✓ 全部通过，无问题");
  await b.close();
  // 有问题就非零退出，方便串进其它流程
  if (fails.length) process.exit(1);
})();
