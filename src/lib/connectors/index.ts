import { registerConnector, createConnector } from "@/lib/connectors/registry";
import { createLdxpConnector } from "@/lib/connectors/ldxp/connector";
import { createLdxpShopConnector } from "@/lib/connectors/ldxp-shop/connector";
import { createMockConnector } from "@/lib/connectors/mock/connector";
import { loadCredentials } from "@/lib/source-credentials";
import type { ProviderId, SourceConnector } from "@/lib/connectors/types";
import { prisma } from "@/lib/db";
import { getSourceFetch } from "@/lib/connectors/proxy-fetch";
import { loadEnv } from "@/lib/env";

/**
 * 连接器注册。
 *
 * 新增一个货源平台就在这里加一行——同步引擎、导入流程、Worker
 * 都只认 SourceConnector 接口，不需要任何改动。
 */
registerConnector("LDXP_MERCHANT", createLdxpConnector);
// 公开店铺：不需要任何凭据，token 就是店铺地址里那段路径
registerConnector("LDXP_SHOP", createLdxpShopConnector);
registerConnector("MOCK", createMockConnector);

export * from "@/lib/connectors/types";
export * from "@/lib/connectors/registry";

/** 按账号 ID 创建连接器（自动解密凭据）。 */
export async function connectorForAccount(
  accountId: string,
): Promise<SourceConnector | null> {
  const account = await prisma.sourceAccount.findUnique({
    where: { id: accountId },
    select: { provider: true },
  });
  if (!account) return null;

  const credentials = await loadCredentials(accountId);
  if (!credentials) return null;

  return createConnector(account.provider as ProviderId, credentials, {
    // 请求最小间隔，也是限流器加速下限。调大 SOURCE_MIN_INTERVAL_MS 对货源更温和（spec §12.4）。
    jitterMs: loadEnv().SOURCE_MIN_INTERVAL_MS,
    timeoutMs: 15_000,
    // 配了 SOURCE_HTTP_PROXY 就走代理出口，没配就是普通 fetch。
    fetchImpl: getSourceFetch(),
  });
}
