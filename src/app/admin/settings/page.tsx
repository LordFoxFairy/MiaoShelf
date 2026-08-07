import { LogOut, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { readSession } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";
import { prisma } from "@/lib/db";

export const metadata = { title: "设置" };
export const dynamic = "force-dynamic";

/**
 * 设置页。
 *
 * 同步频率、限流阈值等参数都通过环境变量配置（见 .env.example），
 * 这里只做只读展示——让运维参数集中在一处，避免"改了数据库还是没生效"。
 */
export default async function SettingsPage() {
  const [session, stats] = await Promise.all([
    readSession(),
    prisma.$transaction([
      prisma.product.count(),
      prisma.sourceProduct.count(),
      prisma.clickEvent.count(),
    ]),
  ]);

  const [productCount, sourceCount, eventCount] = stats;

  const config = [
    { label: "站点名称", value: process.env.NEXT_PUBLIC_SITE_NAME ?? "MiaoKit Catalog" },
    { label: "站点地址", value: process.env.PUBLIC_SITE_URL ?? "—" },
    { label: "货源平台", value: process.env.LDXP_BASE_URL ?? "https://www.ldxp.cn" },
    {
      label: "允许跳转域名",
      value: process.env.LDXP_ALLOWED_REDIRECT_HOSTS || "（未配置，仅做内网防护）",
    },
    {
      label: "外部写操作",
      value: process.env.ENABLE_LDXP_WRITE === "true" ? "已开启" : "已关闭（推荐）",
    },
    { label: "低库存阈值", value: process.env.LOW_STOCK_THRESHOLD ?? "5" },
    {
      label: "同步频率（热/普通/冷）",
      value: `${process.env.SYNC_HOT_SECONDS ?? 60}s / ${process.env.SYNC_NORMAL_SECONDS ?? 300}s / ${process.env.SYNC_COLD_SECONDS ?? 1800}s`,
    },
    {
      label: "点击确认超时",
      value: `${process.env.CLICK_RESOLVE_TIMEOUT_MS ?? 2000}ms`,
    },
    {
      label: "反向代理模式",
      value:
        process.env.TRUSTED_PROXY_MODE === "cloudflare"
          ? "Cloudflare（读 CF-Connecting-IP）"
          : (process.env.TRUSTED_PROXY_MODE ?? "none"),
    },
  ];

  return (
    <>
      <PageHeader
        title="设置"
        description="运行参数通过环境变量配置，修改后需重启服务。"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">当前配置</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              {config.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/40 pb-2 last:border-0 last:pb-0"
                >
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="max-w-[60%] truncate text-right font-medium">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">数据概况</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Row label="展示商品" value={productCount} />
                <Row label="货源商品" value={sourceCount} />
                <Row label="埋点事件" value={eventCount} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">当前账号</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {session?.email ?? "—"}
              </p>
              <form action={logoutAction}>
                <Button type="submit" variant="outline" size="sm">
                  <LogOut className="size-4" />
                  退出登录
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="flex gap-2.5 rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-state-ok" />
            <p>
              货源账号的密码、Cookie 与 Token 全部加密存储，
              不会明文入库、不写日志、不返回浏览器。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
