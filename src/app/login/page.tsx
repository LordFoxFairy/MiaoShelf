import { redirect } from "next/navigation";
import { Rocket } from "lucide-react";

import { hasAnyAdmin, readSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "登录" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // 已登录就别再看登录页了。
  if (await readSession()) redirect("/admin");

  const ready = await hasAnyAdmin();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Rocket className="size-6" />
          </span>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">
              MiaoKit Catalog
            </h1>
            <p className="text-sm text-muted-foreground">
              登录管理后台
            </p>
          </div>
        </div>

        {ready ? (
          <LoginForm />
        ) : (
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">还没有管理员账号</p>
            <p className="mt-2">请先在服务器上执行：</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">
              pnpm create-admin
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
