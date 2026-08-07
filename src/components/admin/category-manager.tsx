"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteCategoryAction,
  saveCategoryAction,
} from "@/app/actions/categories";
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
import { Textarea } from "@/components/ui/textarea";

interface EditableCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isVisible: boolean;
  productCount: number;
}

export function CategoryManager({
  mode,
  category,
}: {
  mode: "create" | "edit";
  category?: EditableCategory;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveCategoryAction(category?.id ?? null, formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message ?? "已保存");
        setOpen(false);
        router.refresh();
      }
    });
  };

  const handleDelete = () => {
    if (!category) return;
    const warning =
      category.productCount > 0
        ? `「${category.name}」下有 ${category.productCount} 个商品，删除后它们会变为未分类。确定吗？`
        : `确定删除「${category.name}」？`;
    if (!confirm(warning)) return;

    startTransition(async () => {
      const result = await deleteCategoryAction(category.id);
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message ?? "已删除");
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      {mode === "create" ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          新建分类
        </Button>
      ) : (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="编辑分类"
          onClick={() => setOpen(true)}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "新建分类" : "编辑分类"}
            </DialogTitle>
            <DialogDescription>
              slug 会成为前台地址的一部分：/category/&lt;slug&gt;
            </DialogDescription>
          </DialogHeader>

          <form action={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">分类名称</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={category?.name ?? ""}
                placeholder="例如：AI 工具"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">slug</Label>
              <Input
                id="slug"
                name="slug"
                required
                defaultValue={category?.slug ?? ""}
                placeholder="ai-tools"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
              />
              <p className="text-xs text-muted-foreground">
                只能用小写字母、数字和连字符
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                name="description"
                rows={2}
                defaultValue={category?.description ?? ""}
              />
            </div>

            <div className="grid grid-cols-2 items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="sortOrder">排序</Label>
                <Input
                  id="sortOrder"
                  name="sortOrder"
                  type="number"
                  defaultValue={category?.sortOrder ?? 0}
                />
              </div>

              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  name="isVisible"
                  defaultChecked={category?.isVisible ?? true}
                  className="size-4 rounded border-border accent-primary"
                />
                前台显示
              </label>
            </div>

            <DialogFooter className="gap-2">
              {mode === "edit" ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="mr-auto"
                  disabled={pending}
                  onClick={handleDelete}
                >
                  <Trash2 className="size-4" />
                  删除
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
