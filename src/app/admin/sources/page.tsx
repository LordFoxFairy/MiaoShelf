import { Plug } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { SourceAccountCard } from "@/components/admin/source-account-card";
import { AddAccountDialog } from "@/components/admin/add-account-dialog";
import { listSafeAccounts } from "@/lib/source-credentials";

export const metadata = { title: "货源账号" };
export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const accounts = await listSafeAccounts();

  return (
    <>
      <PageHeader
        title="货源账号"
        description="配置链动小铺账号并建立登录会话。凭据全部加密存储。"
        actions={<AddAccountDialog />}
      />

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={Plug}
            title="还没有配置货源账号"
            description="添加一个链动小铺账号，填入登录账号和密码，系统会自动登录并保存会话。"
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <SourceAccountCard key={account.id} account={account} />
          ))}
        </div>
      )}
    </>
  );
}
