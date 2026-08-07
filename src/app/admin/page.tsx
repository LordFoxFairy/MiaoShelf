import {
  AlertTriangle,
  Eye,
  MousePointerClick,
  Package,
  PackageX,
  Send,
  ShieldAlert,
  FileEdit,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStats } from "@/lib/queries/dashboard";
import { SyncRunList } from "@/components/admin/sync-run-list";

export const metadata = { title: "仪表盘" };
/** 后台一律不缓存（spec §13.6）。 */
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const stats = await getDashboardStats();

  return (
    <>
      <PageHeader
        title="仪表盘"
        description="统一管理货源、商品内容、库存状态与对外展示"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="商品总数" value={stats.totalProducts} icon={Package} />
        <StatCard
          label="已发布"
          value={stats.publishedProducts}
          icon={Send}
          tone="ok"
        />
        <StatCard label="草稿" value={stats.draftProducts} icon={FileEdit} />
        <StatCard
          label="缺货"
          value={stats.outOfStockProducts}
          icon={PackageX}
          tone={stats.outOfStockProducts > 0 ? "warn" : "default"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="状态异常"
          value={stats.erroredProducts}
          hint="同步失败，仍展示上次可信状态"
          icon={AlertTriangle}
          tone={stats.erroredProducts > 0 ? "danger" : "default"}
        />
        <StatCard
          label="登录失效账号"
          value={stats.accountsNeedingAuth}
          hint={
            stats.accountsNeedingAuth > 0 ? "需要重新登录或导入会话" : "全部正常"
          }
          icon={ShieldAlert}
          tone={stats.accountsNeedingAuth > 0 ? "danger" : "default"}
        />
        <StatCard label="今日访问" value={stats.viewsToday} icon={Eye} />
        <StatCard
          label="今日跳转"
          value={stats.redirectsToday}
          icon={MousePointerClick}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近同步任务</CardTitle>
        </CardHeader>
        <CardContent>
          <SyncRunList runs={stats.recentRuns} />
        </CardContent>
      </Card>
    </>
  );
}
