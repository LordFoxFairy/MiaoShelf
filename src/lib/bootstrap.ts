import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

/**
 * 首次启动时从环境变量自动创建货源账号。
 *
 * 目的：部署完不用先进后台点一遍，环境变量配好就能直接用。
 *
 * 只在账号不存在时创建——已经存在就不动，避免每次重启把你在后台
 * 改过的配置覆盖回去。
 */

function masterKey(): string | null {
  const key = process.env.CREDENTIAL_MASTER_KEY;
  return key && key.length >= 32 ? key : null;
}

export async function bootstrapSourceAccounts(): Promise<void> {
  const key = masterKey();
  if (!key) return;

  await bootstrapShop(key);
  await bootstrapMerchant(key);
}

/**
 * 公开店铺：只要配了店铺地址就能用，不需要凭据。
 * 这是展示自己店铺商品的推荐方式。
 */
async function bootstrapShop(key: string): Promise<void> {
  const shopUrl = process.env.LDXP_SHOP_URL?.trim();
  if (!shopUrl) return;

  const existing = await prisma.sourceAccount.findFirst({
    where: { provider: "LDXP_SHOP" },
    select: { id: true },
  });
  if (existing) return;

  await prisma.sourceAccount.create({
    data: {
      name: "我的小铺",
      provider: "LDXP_SHOP",
      baseUrl: shopUrl,
      // 公开接口没有会话概念，创建即可用
      sessionStatus: "CONNECTED",
      isEnabled: true,
    },
  });
}

/**
 * 商家后台：需要账号密码，能拿到成本价和货源广场。
 * 创建后仍需在后台点「登录」建立会话。
 */
async function bootstrapMerchant(key: string): Promise<void> {
  const username = process.env.LDXP_USERNAME?.trim();
  const password = process.env.LDXP_PASSWORD?.trim();
  if (!username || !password) return;

  const existing = await prisma.sourceAccount.findFirst({
    where: { provider: "LDXP_MERCHANT" },
    select: { id: true },
  });
  if (existing) return;

  await prisma.sourceAccount.create({
    data: {
      name: "商家后台",
      provider: "LDXP_MERCHANT",
      baseUrl: process.env.LDXP_BASE_URL ?? "https://www.ldxp.cn",
      encryptedUsername: encryptSecret(username, key),
      encryptedPassword: encryptSecret(password, key),
      // 还没登录，等管理员在后台点「登录」
      sessionStatus: "DISCONNECTED",
      isEnabled: true,
    },
  });
}
