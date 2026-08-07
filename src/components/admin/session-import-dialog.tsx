"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { importSessionAction } from "@/app/actions/sources";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * 手动导入会话（spec §10.3）。
 *
 * 自动登录遇到验证码时的兜底方案：你在浏览器里正常登录小铺，
 * 从开发者工具复制 Cookie 和 auth-token 贴进来。
 */
export function SessionImportDialog({
  accountId,
  accountName,
  open,
  onOpenChange,
}: {
  accountId: string;
  accountName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  // 在提交回调里处理结果，避免在 effect 里 setState。
  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await importSessionAction(accountId, {}, formData);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "已导入");
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入登录会话</DialogTitle>
          <DialogDescription>
            为「{accountName}」手动导入会话。适用于自动登录遇到验证码的情况。
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          <ol className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <li>1. 在浏览器里正常登录小铺商家后台</li>
            <li>2. 按 F12 打开开发者工具</li>
            <li>
              3. 在 Console 里执行{" "}
              <code className="rounded bg-background px-1 py-0.5">
                document.cookie
              </code>{" "}
              复制结果
            </li>
            <li>
              4. 执行{" "}
              <code className="rounded bg-background px-1 py-0.5">
                localStorage.getItem(&apos;auth-token&apos;)
              </code>{" "}
              复制结果
            </li>
          </ol>

          <div className="space-y-2">
            <Label htmlFor="cookie">Cookie</Label>
            <Textarea
              id="cookie"
              name="cookie"
              rows={3}
              placeholder="name1=value1; name2=value2; …"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="merchantToken">
              Merchant-Token（auth-token 的值）
            </Label>
            <Textarea
              id="merchantToken"
              name="merchantToken"
              rows={2}
              placeholder="纯字符串，或 {&quot;value&quot;:&quot;…&quot;} 形式都可以"
              className="font-mono text-xs"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            这些凭据会加密后存储，不会明文入库、不会写日志、不会返回给浏览器。
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "正在验证…" : "导入并验证"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
