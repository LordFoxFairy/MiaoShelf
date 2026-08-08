/**
 * 公开店铺连接器冒烟测试 —— 「踩几下」真实代码路径。
 *
 *   pnpm smoke-shop
 *   SMOKE_SHOP_URL=https://pay.ldxp.cn/shop/xxx pnpm smoke-shop
 *
 * 和 check-source 的区别：check-source 用裸 fetch 直接打接口，
 * 这里走完整的 LdxpShopConnector + AdaptiveRateLimiter，验证真实同步链路。
 *
 * 只读公开店铺接口（/shopApi/Shop/*），不碰任何需要登录的商家后台数据。
 *
 * 「clock」：给限流器注入一个假时钟，把它的节奏推进做成确定性的，
 * 这样既能观察 429 冷却逻辑，又不用真的 sleep 等墙钟时间。
 */
import { LdxpShopConnector } from "@/lib/connectors/ldxp-shop/connector";
import { AdaptiveRateLimiter } from "@/lib/connectors/rate-limiter";
import { getSourceFetch, proxyLabel } from "@/lib/connectors/proxy-fetch";

const SHOP_URL = process.env.SMOKE_SHOP_URL ?? "https://pay.ldxp.cn/shop/miaoli";

/** 假时钟：手动推进，喂给限流器验证冷却/节奏逻辑，不占用墙钟时间。 */
function fakeClock(startMs = 1_000_000) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** 先单独踩一下限流器：确认 429 冷却窗口随假时钟推进而开合。 */
function exerciseLimiter() {
  const clock = fakeClock();
  const limiter = new AdaptiveRateLimiter({ baseDelayMs: 0 });

  console.log("— 限流器（假时钟驱动）—");
  console.log("  初始延迟:", limiter.currentDelayMs, "ms");

  limiter.onRateLimited(clock.now);
  console.log("  收到 429 →延迟:", limiter.currentDelayMs, "ms，进入冷却");
  console.log("  冷却中?", limiter.isCoolingDown(clock.now), "（期望 true）");

  clock.advance(29_000);
  console.log("  +29s 冷却中?", limiter.isCoolingDown(clock.now), "（期望 true）");

  clock.advance(2_000);
  console.log("  +31s 冷却中?", limiter.isCoolingDown(clock.now), "（期望 false）");
  console.log("");
}

async function main() {
  console.log("店铺:", SHOP_URL);
  console.log("出口:", proxyLabel() ?? "直连（未配置代理）");
  console.log("");

  exerciseLimiter();

  // MANUAL=1 时开启浏览器兜底 + 手动闯关：撞 WAF 会弹出浏览器等你手动滑过。
  const manual = process.env.MANUAL === "1" || process.env.MANUAL === "true";
  const browserFallback = manual
    ? {
        profilePath:
          process.env.SMOKE_PROFILE_PATH ?? "./data/browser-profiles/smoke",
        headless: false, // 手动滑必须有头
        manual: true,
        manualTimeoutMs: 0, // 一直等你
      }
    : undefined;

  if (manual) {
    console.log("— 手动模式：撞 WAF 会弹出浏览器，请手动完成验证，程序一直等 —");
    console.log("");
  }

  // baseDelayMs=0（经 jitterMs 传入）→ waitTurn 不做真实 sleep，冒烟测试跑得快。
  const connector = new LdxpShopConnector(
    { baseUrl: SHOP_URL, username: "", password: "" },
    { fetchImpl: getSourceFetch(), jitterMs: 0, browserFallback },
  );

  console.log("— 真实连接器（公开接口）—");

  // 1. 会话校验（公开店铺：能拿到店铺信息就算通）
  const session = await connector.verifySession();
  console.log("  verifySession:", session.valid ? "✓ 通" : "✗ 不通", "—", session.message ?? "");
  if (!session.valid) {
    console.log("");
    console.log("店铺信息都拿不到，后面就不踩了。");
    process.exit(1);
  }

  // 2. 店铺名
  const name = await connector.getShopName();
  console.log("  getShopName:", name ?? "（未返回）");

  // 3. 全量商品（四种类型都遍历，这是真实同步会做的事）
  console.log("  listAll: 遍历中…");
  const page = await connector.listAll({ page: 1, pageSize: 100 });
  console.log("  listAll: 拿到", page.items.length, "个商品，total =", page.total);

  // 抽样看几条，确认字段映射正常
  const sample = page.items.slice(0, 5);
  for (const g of sample) {
    console.log(
      `    · ${g.title ?? "(无标题)"} | ¥${g.price ?? "?"} | 库存 ${g.stockCount ?? "—"} | ${g.availabilityHint ?? "—"} | ${g.goodsType}`,
    );
  }

  // 4. 单品详情 + 链接解析，踩一下详情链路
  if (sample[0]?.externalId) {
    const id = sample[0].externalId;
    const detail = await connector.fetchDetail(id);
    console.log("  fetchDetail:", detail.title ?? id, "| 库存", detail.stockCount ?? "—");
    const link = await connector.resolveLink(id);
    console.log("  resolveLink:", link.url ?? "（无）");
  }

  console.log("");
  console.log("✓ 全链路踩通，公开店铺同步正常。");
}

main().catch((error) => {
  console.log("");
  console.log("✗ 冒烟失败:", error instanceof Error ? error.message : error);
  process.exit(1);
});
