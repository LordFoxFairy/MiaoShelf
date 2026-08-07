"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Link2Off, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteProductsAction,
  refreshProductsAction,
  setPublicationAction,
  unlinkSourceAction,
  updateProductAction,
} from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface EditableProduct {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  coverUrl: string | null;
  buttonText: string;
  priceMode: string;
  priceAdjustment: string | null;
  categoryId: string | null;
  targetUrlOverride: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  sortOrder: number;
  featured: boolean;
  autoHideWhenOutOfStock: boolean;
  publicationStatus: string;
  hasSource: boolean;
}

const PRICE_MODES = [
  { value: "SOURCE", label: "跟随货源价" },
  { value: "FIXED", label: "固定价格" },
  { value: "MARKUP_PERCENT", label: "按百分比加价" },
  { value: "MARKUP_FIXED", label: "按固定金额加价" },
  { value: "HIDDEN", label: "不展示价格" },
];

export function ProductEditor({
  product,
  categories,
}: {
  product: EditableProduct;
  categories: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{ ok?: boolean; error?: string; message?: string }>,
    loading: string,
    after?: () => void,
  ) => {
    startTransition(async () => {
      const id = toast.loading(loading);
      const result = await action();
      toast.dismiss(id);
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message ?? "完成");
        after?.();
        router.refresh();
      }
    });
  };

  const handleSave = (formData: FormData) => {
    run(
      () => updateProductAction(product.id, {}, formData),
      "正在保存…",
    );
  };

  const published = product.publicationStatus === "PUBLISHED";

  return (
    <form action={handleSave} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">展示内容</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">展示标题</Label>
            <Input
              id="title"
              name="title"
              defaultValue={product.title}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subtitle">副标题</Label>
            <Input
              id="subtitle"
              name="subtitle"
              defaultValue={product.subtitle ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="coverUrl">封面图地址</Label>
            <Input
              id="coverUrl"
              name="coverUrl"
              type="url"
              defaultValue={product.coverUrl ?? ""}
              placeholder="https://…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">商品介绍</Label>
            <Textarea
              id="description"
              name="description"
              rows={6}
              defaultValue={product.description ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">价格与分类</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="priceMode">价格模式</Label>
            <select
              id="priceMode"
              name="priceMode"
              defaultValue={product.priceMode}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
            >
              {PRICE_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="priceAdjustment">固定价 / 加价幅度</Label>
            <Input
              id="priceAdjustment"
              name="priceAdjustment"
              type="number"
              step="0.01"
              defaultValue={product.priceAdjustment ?? ""}
              placeholder="按百分比时填 15 表示 +15%"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="categoryId">分类</Label>
            <select
              id="categoryId"
              name="categoryId"
              defaultValue={product.categoryId ?? ""}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
            >
              <option value="">未分类</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sortOrder">排序（数字越小越靠前）</Label>
            <Input
              id="sortOrder"
              name="sortOrder"
              type="number"
              defaultValue={product.sortOrder}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="featured"
              defaultChecked={product.featured}
              className="size-4 rounded border-border accent-primary"
            />
            首页推荐
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="autoHideWhenOutOfStock"
              defaultChecked={product.autoHideWhenOutOfStock}
              className="size-4 rounded border-border accent-primary"
            />
            缺货时自动隐藏
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">跳转与 SEO</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="buttonText">按钮文字</Label>
            <Input
              id="buttonText"
              name="buttonText"
              defaultValue={product.buttonText}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetUrlOverride">自定义跳转地址</Label>
            <Input
              id="targetUrlOverride"
              name="targetUrlOverride"
              type="url"
              defaultValue={product.targetUrlOverride ?? ""}
              placeholder="留空则使用货源自带链接"
            />
            <p className="text-xs text-muted-foreground">
              必须在允许的域名列表内，否则跳转会被拦截。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="seoTitle">SEO 标题</Label>
            <Input
              id="seoTitle"
              name="seoTitle"
              defaultValue={product.seoTitle ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="seoDescription">SEO 描述</Label>
            <Textarea
              id="seoDescription"
              name="seoDescription"
              rows={2}
              defaultValue={product.seoDescription ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          <Save className="size-4" />
          保存
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                setPublicationAction(
                  [product.id],
                  published ? "HIDDEN" : "PUBLISHED",
                ),
              published ? "正在隐藏…" : "正在发布…",
            )
          }
        >
          {published ? (
            <>
              <EyeOff className="size-4" />
              隐藏
            </>
          ) : (
            <>
              <Eye className="size-4" />
              发布
            </>
          )}
        </Button>

        {product.hasSource ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => refreshProductsAction([product.id]), "正在刷新…")
              }
            >
              <RefreshCw className="size-4" />
              立即刷新
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (
                  !confirm(
                    "取消对接后该商品不再自动同步，展示内容会保留。确定吗？",
                  )
                ) {
                  return;
                }
                run(() => unlinkSourceAction(product.id), "正在取消对接…");
              }}
            >
              <Link2Off className="size-4" />
              取消对接
            </Button>
          </>
        ) : null}

        <Button
          type="button"
          variant="destructive"
          className="ml-auto"
          disabled={pending}
          onClick={() => {
            if (!confirm(`确定删除「${product.title}」？此操作不可撤销。`)) return;
            run(
              () => deleteProductsAction([product.id]),
              "正在删除…",
              () => router.push("/admin/products"),
            );
          }}
        >
          <Trash2 className="size-4" />
          删除
        </Button>
      </div>
    </form>
  );
}
