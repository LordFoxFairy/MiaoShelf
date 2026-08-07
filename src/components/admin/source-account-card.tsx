"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  MoreVertical,
  Package,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import type { SafeSourceAccount } from "@/lib/source-credentials";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteAccountAction,
  loginAccountAction,
  verifyAccountAction,
} from "@/app/actions/sources";
import { SessionImportDialog } from "@/components/admin/session-import-dialog";

const SESSION_STYLES: Record<
  string,
  { label: string; className: string; hint?: string }
> = {
  CONNECTED: {
    label: "已连接",
    className: "bg-state-ok-bg text-state-ok",
  },
  DISCONNECTED: {
    label: "未连接",
    className: "bg-muted text-muted-foreground",
    hint: "填好账号密码后点「登录」建立会话",
  },
  NEEDS_VERIFICATION: {
    label: "需要人工验证",
    className: "bg-state-low-bg text-state-low",
    hint: "登录时遇到验证码，请在浏览器登录后导入 Cookie",
  },
  AUTH_REQUIRED: {
    label: "登录已失效",
    className: "bg-state-out-bg text-state-out",
    hint: "会话过期，请重新登录",
  },
  ERROR: {
    label: "异常",
    className: "bg-state-out-bg text-state-out",
  },
};

export function SourceAccountCard({
  account,
}: {
  account: SafeSourceAccount;
}) {
  const [pending, startTransition] = useTransition();
  const [importOpen, setImportOpen] = useState(false);

  const session = SESSION_STYLES[account.sessionStatus] ?? {
    label: account.sessionStatus,
    className: "bg-muted text-muted-foreground",
  };

  const run = (
    action: () => Promise<{ ok?: boolean; error?: string; message?: string }>,
    loadingText: string,
  ) => {
    startTransition(async () => {
      const id = toast.loading(loadingText);
      try {
        const result = await action();
        toast.dismiss(id);
        if (result.error) toast.error(result.error);
        else toast.success(result.message ?? "完成");
      } catch (error) {
        toast.dismiss(id);
        toast.error(error instanceof Error ? error.message : "操作失败");
      }
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">{account.name}</h3>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                session.className,
              )}
            >
              {session.label}
            </span>
            {!account.isEnabled ? (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                已停用
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {account.baseUrl}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="更多操作" />
            }
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setImportOpen(true)}>
              <KeyRound className="size-4" />
              导入 Cookie / Token
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                if (
                  !confirm(
                    `确定删除「${account.name}」？\n该账号下的 ${account.productCount} 条货源数据会一并删除，但你已编辑的展示商品会保留。`,
                  )
                ) {
                  return;
                }
                run(() => deleteAccountAction(account.id), "正在删除…");
              }}
            >
              <Trash2 className="size-4" />
              删除账号
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Field label="登录账号" value={account.hasUsername ? "已配置" : "未配置"} />
        <Field label="密码" value={account.hasPassword ? "已配置" : "未配置"} />
        <Field label="Cookie" value={account.hasCookie ? "已保存" : "无"} />
        <Field
          label="Merchant-Token"
          value={account.hasToken ? "已保存" : "无"}
        />
        <Field
          label="最近验证"
          value={
            account.lastVerifiedAt
              ? new Date(account.lastVerifiedAt).toLocaleString("zh-CN")
              : "—"
          }
        />
        <Field label="货源商品" value={String(account.productCount)} />
      </dl>

      {session.hint || account.lastError ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{account.lastError ?? session.hint}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || !account.hasPassword}
          onClick={() =>
            run(
              () => loginAccountAction(account.id),
              "正在登录（可能需要十几秒）…",
            )
          }
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LogIn className="size-4" />
          )}
          登录
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => verifyAccountAction(account.id), "正在测试连接…")
          }
        >
          <CheckCircle2 className="size-4" />
          测试连接
        </Button>

        <Link
          href={`/admin/sources/${account.id}`}
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          <Package className="size-4" />
          浏览货源
        </Link>
      </div>

      <SessionImportDialog
        accountId={account.id}
        accountName={account.name}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
