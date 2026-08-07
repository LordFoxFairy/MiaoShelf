import { PrismaClient } from "@prisma/client";

/**
 * 演示数据。
 * 目的是让"导入 → 编辑 → 发布 → 展示 → 跳转"整条链路在没有真实小铺账号时
 * 也能跑通并看到界面（spec Phase 1 完成标准）。
 */
const prisma = new PrismaClient();

const now = Date.now();
const minutesAgo = (n: number) => new Date(now - n * 60_000);

async function main() {
  // 幂等：重复执行不会堆出一堆重复商品。
  await prisma.clickEvent.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.syncRun.deleteMany();
  await prisma.product.deleteMany();
  await prisma.sourceProduct.deleteMany();
  await prisma.category.deleteMany();
  await prisma.sourceAccount.deleteMany();

  const account = await prisma.sourceAccount.create({
    data: {
      name: "演示货源（Mock）",
      provider: "MOCK",
      baseUrl: "https://mock.local",
      sessionStatus: "CONNECTED",
      lastVerifiedAt: minutesAgo(3),
      isEnabled: true,
    },
  });

  const [aiTools, membership] = await Promise.all([
    prisma.category.create({
      data: { name: "AI 工具", slug: "ai-tools", sortOrder: 1 },
    }),
    prisma.category.create({
      data: { name: "会员充值", slug: "membership", sortOrder: 2 },
    }),
  ]);

  /** 覆盖所有前台状态分支，方便肉眼验证 §7.5 的显示规则。 */
  const fixtures = [
    {
      externalId: "mock-2001",
      title: "ChatGPT Plus 会员 1 个月",
      price: "128.00",
      stock: 42,
      sourceStatus: "ACTIVE",
      availability: "IN_STOCK",
      syncStatus: "FRESH",
      category: aiTools.id,
      published: true,
      lastSuccess: minutesAgo(1),
      freshMinutes: 2,
      staleMinutes: 15,
    },
    {
      externalId: "mock-2002",
      title: "Claude Pro 会员 1 个月",
      price: "145.00",
      stock: 3,
      sourceStatus: "ACTIVE",
      availability: "LOW_STOCK",
      syncStatus: "FRESH",
      category: aiTools.id,
      published: true,
      lastSuccess: minutesAgo(2),
      freshMinutes: 2,
      staleMinutes: 15,
    },
    {
      externalId: "mock-2003",
      title: "Midjourney 标准订阅",
      price: "220.00",
      stock: 0,
      sourceStatus: "ACTIVE",
      availability: "OUT_OF_STOCK",
      syncStatus: "FRESH",
      category: aiTools.id,
      published: true,
      lastSuccess: minutesAgo(4),
      freshMinutes: 2,
      staleMinutes: 15,
      outOfStockStreak: 2,
    },
    {
      externalId: "mock-2004",
      // 同步失败但保留上次可信状态 —— 验证"失败不等于缺货"
      title: "Netflix 高级会员",
      price: "88.00",
      stock: 12,
      sourceStatus: "ACTIVE",
      availability: "IN_STOCK",
      syncStatus: "ERROR",
      category: membership.id,
      published: true,
      lastSuccess: minutesAgo(15),
      freshMinutes: -13,
      staleMinutes: -1,
      failures: 3,
      lastError: "请求超时（15000ms）",
    },
    {
      externalId: "mock-2005",
      title: "Spotify 家庭组",
      price: "45.00",
      stock: null,
      sourceStatus: "INACTIVE",
      availability: "NOT_APPLICABLE",
      syncStatus: "FRESH",
      category: membership.id,
      published: true,
      lastSuccess: minutesAgo(6),
      freshMinutes: 2,
      staleMinutes: 15,
    },
    {
      externalId: "mock-2006",
      title: "YouTube Premium 年卡",
      price: "268.00",
      stock: 8,
      sourceStatus: "ACTIVE",
      availability: "IN_STOCK",
      syncStatus: "STALE",
      category: membership.id,
      published: false, // 草稿，验证前台不可见
      lastSuccess: minutesAgo(9),
      freshMinutes: -7,
      staleMinutes: 6,
    },
  ] as const;

  for (const [index, f] of fixtures.entries()) {
    const sourceProduct = await prisma.sourceProduct.create({
      data: {
        sourceAccountId: account.id,
        externalId: f.externalId,
        goodsType: "card",
        sourceTitle: f.title,
        sourceDescription: `${f.title} —— 演示数据，非真实商品。`,
        sourcePrice: f.price,
        stockCount: f.stock,
        sourceStatus: f.sourceStatus,
        availability: f.availability,
        syncStatus: f.syncStatus,
        sourceUrl: `https://www.ldxp.cn/goods/${f.externalId}`,
        rawPayload: JSON.stringify({ id: f.externalId, name: f.title }),
        lastCheckedAt: minutesAgo(1),
        lastSuccessAt: f.lastSuccess,
        freshUntil: new Date(now + f.freshMinutes * 60_000),
        staleUntil: new Date(now + f.staleMinutes * 60_000),
        nextCheckAt: new Date(now + 5 * 60_000),
        consecutiveFailures: "failures" in f ? f.failures : 0,
        consecutiveOutOfStock:
          "outOfStockStreak" in f ? f.outOfStockStreak : 0,
        lastError: "lastError" in f ? f.lastError : null,
      },
    });

    await prisma.product.create({
      data: {
        sourceProductId: sourceProduct.id,
        slug: f.externalId,
        publicationStatus: f.published ? "PUBLISHED" : "DRAFT",
        title: f.title,
        subtitle: "官方渠道 · 自动发货",
        description: `${f.title}\n\n本页面仅展示商品信息，点击后前往第三方页面完成购买。`,
        coverUrl: null,
        gallery: "[]",
        priceMode: "SOURCE",
        categoryId: f.category,
        tags: JSON.stringify(["演示"]),
        buttonText: "前往商品页",
        sortOrder: index,
        featured: index < 2,
        publishedAt: f.published ? minutesAgo(60) : null,
        lastViewedAt: index < 3 ? minutesAgo(5) : null,
        viewCount: index < 3 ? 40 - index * 8 : 2,
        clickCount: index < 3 ? 12 - index * 3 : 0,
      },
    });
  }

  await prisma.syncRun.createMany({
    data: [
      {
        sourceAccountId: account.id,
        trigger: "SCHEDULE",
        scope: "PRICE_STOCK",
        status: "SUCCESS",
        startedAt: minutesAgo(2),
        finishedAt: new Date(now - 2 * 60_000 + 1400),
        itemsSeen: 6,
        itemsChanged: 2,
        itemsFailed: 0,
        createdAt: minutesAgo(2),
      },
      {
        sourceAccountId: account.id,
        trigger: "MANUAL",
        scope: "PRODUCT",
        status: "PARTIAL",
        startedAt: minutesAgo(18),
        finishedAt: new Date(now - 18 * 60_000 + 3200),
        itemsSeen: 6,
        itemsChanged: 1,
        itemsFailed: 1,
        error: "1 个商品请求超时，已保留上次可信状态",
        createdAt: minutesAgo(18),
      },
      {
        sourceAccountId: account.id,
        trigger: "SCHEDULE",
        scope: "CATALOG",
        status: "SUCCESS",
        startedAt: minutesAgo(62),
        finishedAt: new Date(now - 62 * 60_000 + 8100),
        itemsSeen: 6,
        itemsChanged: 6,
        itemsFailed: 0,
        createdAt: minutesAgo(62),
      },
    ],
  });

  const products = await prisma.product.findMany({ select: { id: true } });
  await prisma.clickEvent.createMany({
    data: products.flatMap((p, i) => [
      { productId: p.id, eventType: "VIEW", createdAt: minutesAgo(30 + i) },
      { productId: p.id, eventType: "VIEW", createdAt: minutesAgo(12 + i) },
      ...(i < 3
        ? [
            {
              productId: p.id,
              eventType: "CLICK" as const,
              createdAt: minutesAgo(10 + i),
            },
            {
              productId: p.id,
              eventType: "REDIRECT" as const,
              createdAt: minutesAgo(10 + i),
            },
          ]
        : []),
    ]),
  });

  console.log("✓ 演示数据已写入：6 个商品、2 个分类、3 条同步记录");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
