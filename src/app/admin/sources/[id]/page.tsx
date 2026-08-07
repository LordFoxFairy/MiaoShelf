import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { getSafeAccount } from "@/lib/source-credentials";
import { connectorForAccount } from "@/lib/connectors";
import { LdxpConnector } from "@/lib/connectors/ldxp/connector";
import { prisma } from "@/lib/db";
import { SourceBrowser } from "@/components/admin/source-browser";
import { safeErrorDetail } from "@/lib/connectors/normalize";
import type { NormalizedGoods } from "@/lib/connectors/types";

export const dynamic = "force-dynamic";

export interface BrowseRow {
  externalId: string;
  title: string;
  priceText: string | null;
  stockCount: number | null;
  sourceStatus: string;
  goodsType: string | null;
  url: string | null;
  /** 已经导入到本站 */
  imported: boolean;
  /** 已对接到自己小铺（child 字段） */
  connected: boolean;
}

export default async function SourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;

  const account = await getSafeAccount(id);
  if (!account) notFound();

  const tab = query.tab === "mine" ? "mine" : "plaza";
  const keywords = typeof query.q === "string" ? query.q : "";
  const goodsType = typeof query.type === "string" ? query.type : "card";
  const page = Number(query.page ?? 1) || 1;

  let rows: BrowseRow[] = [];
  let error: string | null = null;
  let hasMore = false;

  try {
    const connector = await connectorForAccount(id);
    if (!connector) throw new Error("账号不可用");

    const result =
      tab === "mine" && connector instanceof LdxpConnector
        ? await connector.listAll({ page, pageSize: 20, goodsType })
        : await connector.search({ page, pageSize: 20, keywords, goodsType });

    hasMore = result.hasMore;

    // 标记哪些已经导入过，避免重复导入。
    const existing = await prisma.sourceProduct.findMany({
      where: {
        sourceAccountId: id,
        externalId: { in: result.items.map((i) => i.externalId) },
      },
      select: { externalId: true },
    });
    const importedIds = new Set(existing.map((e) => e.externalId));

    rows = result.items.map((item: NormalizedGoods) => ({
      externalId: item.externalId,
      title: item.title ?? `商品 ${item.externalId}`,
      priceText: item.price ? `¥${item.price.toFixed(2)}` : null,
      stockCount: item.stockCount,
      sourceStatus: item.sourceStatus,
      goodsType: item.goodsType,
      url: item.url,
      imported: importedIds.has(item.externalId),
      connected: LdxpConnector.isConnected(
        item.raw as Record<string, unknown>,
      ),
    }));
  } catch (caught) {
    error = safeErrorDetail(
      caught instanceof Error ? caught.message : String(caught),
    );
  }

  return (
    <>
      <PageHeader
        title={account.name}
        description="搜索货源广场或查看你在小铺里已有的商品，勾选后导入为本站草稿。"
      />

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-state-out/30 bg-state-out-bg px-4 py-3 text-sm text-state-out">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">无法连接货源</p>
            <p className="text-xs opacity-90">{error}</p>
            <p className="text-xs opacity-90">
              请回到货源账号页点「登录」，或手动导入 Cookie。
            </p>
          </div>
        </div>
      ) : null}

      <SourceBrowser
        accountId={id}
        rows={rows}
        tab={tab}
        keywords={keywords}
        goodsType={goodsType}
        page={page}
        hasMore={hasMore}
      />
    </>
  );
}
