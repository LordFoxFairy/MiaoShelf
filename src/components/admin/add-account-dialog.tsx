"use client";

import { useState, useTransition } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { createAccountAction } from "@/app/actions/sources";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Mode = "LDXP_SHOP" | "LDXP_MERCHANT";

export function AddAccountDialog() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("LDXP_SHOP");
  const [pending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createAccountAction({}, formData);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "已创建");
        setOpen(false);
      }
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        添加货源
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加货源</DialogTitle>
            <DialogDescription>
              选择接入方式。展示自己的店铺推荐用「公开店铺」。
            </DialogDescription>
          </DialogHeader>

          <form action={handleSubmit} className="space-y-4">
            <input type="hidden" name="provider" value={mode} />

            <div className="grid gap-2 sm:grid-cols-2">
              <ModeCard
                active={mode === "LDXP_SHOP"}
                onClick={() => setMode("LDXP_SHOP")}
                title="公开店铺"
                subtitle="推荐"
                description="填店铺地址即可，不需要账号密码，不会遇到验证码。"
              />
              <ModeCard
                active={mode === "LDXP_MERCHANT"}
                onClick={() => setMode("LDXP_MERCHANT")}
                title="商家后台"
                description="需要账号密码，可搜索货源广场、看成本价。"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input
                id="name"
                name="name"
                required
                placeholder={
                  mode === "LDXP_SHOP" ? "例如：我的小铺" : "例如：我的商家账号"
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseUrl">
                {mode === "LDXP_SHOP" ? "店铺地址" : "平台地址"}
              </Label>
              <Input
                id="baseUrl"
                name="baseUrl"
                type="url"
                required
                key={mode}
                defaultValue={
                  mode === "LDXP_SHOP"
                    ? "https://pay.ldxp.cn/shop/"
                    : "https://www.ldxp.cn"
                }
                placeholder={
                  mode === "LDXP_SHOP"
                    ? "https://pay.ldxp.cn/shop/你的店铺名"
                    : "https://www.ldxp.cn"
                }
              />
              {mode === "LDXP_SHOP" ? (
                <p className="text-xs text-muted-foreground">
                  就是浏览器里打开店铺时的那个地址。
                </p>
              ) : null}
            </div>

            {mode === "LDXP_MERCHANT" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">登录账号</Label>
                  <Input
                    id="username"
                    name="username"
                    required
                    autoComplete="off"
                    placeholder="手机号或账号"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">登录密码</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="new-password"
                  />
                </div>
              </>
            ) : (
              <p className="flex gap-2.5 rounded-lg bg-state-ok-bg px-3 py-2.5 text-xs text-state-ok">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  公开店铺不需要任何凭据，也就没有密码泄露、会话过期和验证码的问题。
                </span>
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "创建中…" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  subtitle,
  description,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-primary/50 bg-accent"
          : "border-border hover:border-border/80 hover:bg-muted/50",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="rounded-full bg-state-ok-bg px-1.5 py-0.5 text-[0.65rem] font-medium text-state-ok">
            {subtitle}
          </span>
        ) : null}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
