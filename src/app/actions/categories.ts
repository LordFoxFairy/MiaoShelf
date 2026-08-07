"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import { bumpCatalogVersion } from "@/lib/cache";
import { slugSchema } from "@/lib/schemas";
import type { ActionState } from "@/app/actions/sources";

async function requireAdmin(): Promise<void> {
  const session = await readSession();
  if (!session) throw new Error("未登录");
}

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: slugSchema,
  description: z.string().trim().max(300).nullable(),
  sortOrder: z.coerce.number().int(),
  isVisible: z.boolean(),
});

export async function saveCategoryAction(
  categoryId: string | null,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description") || null,
    sortOrder: formData.get("sortOrder") || 0,
    isVisible: formData.get("isVisible") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  // slug 是前台路由的一部分，重复会导致两个分类抢同一个地址。
  const conflict = await prisma.category.findFirst({
    where: {
      slug: parsed.data.slug,
      ...(categoryId ? { NOT: { id: categoryId } } : {}),
    },
    select: { id: true },
  });
  if (conflict) return { error: `slug「${parsed.data.slug}」已被占用` };

  if (categoryId) {
    await prisma.category.update({
      where: { id: categoryId },
      data: parsed.data,
    });
  } else {
    await prisma.category.create({ data: parsed.data });
  }

  await bumpCatalogVersion();
  revalidatePath("/admin/categories");
  revalidatePath("/");
  return { ok: true, message: categoryId ? "已保存" : "分类已创建" };
}

/**
 * 删除分类。
 * 分类下的商品不会被删，只是变成"未分类"（schema 里是 SetNull）。
 */
export async function deleteCategoryAction(
  categoryId: string,
): Promise<ActionState> {
  await requireAdmin();

  await prisma.category.delete({ where: { id: categoryId } });

  await bumpCatalogVersion();
  revalidatePath("/admin/categories");
  revalidatePath("/");
  return { ok: true, message: "分类已删除，其下商品已变为未分类" };
}
