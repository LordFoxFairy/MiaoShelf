"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import { connectorForAccount } from "@/lib/connectors";
import { enqueueRefresh } from "@/lib/sync/queue";
import { refreshSourceProduct } from "@/lib/sync/refresh";
import { bumpCatalogVersion } from "@/lib/cache";
import { productUpdateSchema } from "@/lib/schemas";
import { safeErrorDetail } from "@/lib/connectors/normalize";
import { computeFreshnessWindow } from "@/lib/scheduling";
import {
  applyTagOperation,
  normalizeTags,
  parseTags,
  serializeTags,
  suggestTags,
} from "@/lib/tags";
import type { ActionState } from "@/app/actions/sources";

async function requireAdmin(): Promise<void> {
  const session = await readSession();
  if (!session) throw new Error("未登录");
}

/**
 * 导入货源商品（spec §11.2）。
 *
 * "导入"不是调用小铺的一键对接接口，而是：
 *   upsert SourceProduct → 创建 Product 草稿 → 复制原始内容作为初始值
 *
 * 重复导入同一个商品只更新货源数据，不会重复建展示商品。
 */
export async function importGoodsAction(
  accountId: string,
  externalIds: string[],
): Promise<ActionState & { imported?: number; skipped?: number }> {
  await requireAdmin();

  if (externalIds.length === 0) return { error: "请先选择要导入的商品" };

  const connector = await connectorForAccount(accountId);
  if (!connector) return { error: "货源账号不可用" };

  const now = new Date();
  const { freshUntil, staleUntil } = computeFreshnessWindow("NORMAL", now);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const externalId of externalIds) {
    try {
      const goods = await connector.fetchDetail(externalId);

      const sourceProduct = await prisma.sourceProduct.upsert({
        where: {
          sourceAccountId_externalId: { sourceAccountId: accountId, externalId },
        },
        create: {
          sourceAccountId: accountId,
          externalId,
          goodsType: goods.goodsType,
          sourceTitle: goods.title,
          sourceDescription: goods.description,
          sourceImageUrl: goods.imageUrl,
          sourcePrice: goods.price?.toString() ?? null,
          stockCount: goods.stockCount,
          sourceStatus: goods.sourceStatus,
          availability: goods.availabilityHint ?? "UNKNOWN",
          syncStatus: "FRESH",
          sourceUrl: goods.url,
          rawPayload: JSON.stringify(goods.raw),
          lastCheckedAt: now,
          lastSuccessAt: now,
          freshUntil,
          staleUntil,
          nextCheckAt: new Date(now.getTime() + 300_000),
        },
        update: {
          // 重复导入只刷新货源数据
          sourceTitle: goods.title,
          sourcePrice: goods.price?.toString() ?? null,
          stockCount: goods.stockCount,
          sourceStatus: goods.sourceStatus,
          availability: goods.availabilityHint ?? "UNKNOWN",
          syncStatus: "FRESH",
          sourceUrl: goods.url,
          rawPayload: JSON.stringify(goods.raw),
          lastCheckedAt: now,
          lastSuccessAt: now,
          freshUntil,
          staleUntil,
        },
        include: { products: { select: { id: true } } },
      });

      // 已经有展示商品了就不重复创建（spec §11.2）。
      if (sourceProduct.products.length > 0) {
        skipped += 1;
        continue;
      }

      await prisma.product.create({
        data: {
          sourceProductId: sourceProduct.id,
          slug: await uniqueSlug(externalId),
          publicationStatus: "DRAFT",
          title: goods.title ?? `商品 ${externalId}`,
          description: goods.description,
          coverUrl: goods.imageUrl,
          gallery: "[]",
          tags: "[]",
          priceMode: "SOURCE",
          buttonText: "前往商品页",
          manualLock: false,
          autoHideWhenOutOfStock: false,
        },
      });

      imported += 1;
    } catch (error) {
      errors.push(
        `${externalId}: ${safeErrorDetail(error instanceof Error ? error.message : String(error), 80)}`,
      );
    }
  }

  revalidatePath("/admin/products");
  revalidatePath(`/admin/sources/${accountId}`);

  if (imported === 0 && errors.length > 0) {
    return { error: `导入失败：${errors[0]}` };
  }

  return {
    ok: true,
    imported,
    skipped,
    message: [
      `已导入 ${imported} 个商品为草稿`,
      skipped > 0 ? `${skipped} 个已存在` : null,
      errors.length > 0 ? `${errors.length} 个失败` : null,
    ]
      .filter(Boolean)
      .join("，"),
  };
}

/** slug 冲突时加后缀，保证唯一。 */
async function uniqueSlug(base: string): Promise<string> {
  const normalized =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "product";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? normalized : `${normalized}-${attempt}`;
    const exists = await prisma.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `${normalized}-${Date.now()}`;
}

export async function updateProductAction(
  productId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const raw = {
    title: formData.get("title") || undefined,
    subtitle: formData.get("subtitle") || null,
    description: formData.get("description") || null,
    coverUrl: formData.get("coverUrl") || null,
    buttonText: formData.get("buttonText") || undefined,
    priceMode: formData.get("priceMode") || undefined,
    priceAdjustment: formData.get("priceAdjustment") || null,
    categoryId: formData.get("categoryId") || null,
    targetUrlOverride: formData.get("targetUrlOverride") || null,
    seoTitle: formData.get("seoTitle") || null,
    seoDescription: formData.get("seoDescription") || null,
    sortOrder: formData.get("sortOrder") || undefined,
    featured: formData.get("featured") === "on",
    autoHideWhenOutOfStock: formData.get("autoHideWhenOutOfStock") === "on",
  };

  const parsed = productUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  const data = parsed.data;
  await prisma.product.update({
    where: { id: productId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.coverUrl !== undefined ? { coverUrl: data.coverUrl } : {}),
      ...(data.buttonText !== undefined ? { buttonText: data.buttonText } : {}),
      ...(data.priceMode !== undefined ? { priceMode: data.priceMode } : {}),
      ...(data.priceAdjustment !== undefined
        ? {
            priceAdjustment:
              data.priceAdjustment === null
                ? null
                : String(data.priceAdjustment),
          }
        : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.targetUrlOverride !== undefined
        ? { targetUrlOverride: data.targetUrlOverride }
        : {}),
      ...(data.seoTitle !== undefined ? { seoTitle: data.seoTitle } : {}),
      ...(data.seoDescription !== undefined
        ? { seoDescription: data.seoDescription }
        : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.featured !== undefined ? { featured: data.featured } : {}),
      ...(data.autoHideWhenOutOfStock !== undefined
        ? { autoHideWhenOutOfStock: data.autoHideWhenOutOfStock }
        : {}),
    },
  });

  await bumpCatalogVersion();
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message: "已保存" };
}

/** 发布 / 隐藏 / 转草稿。 */
export async function setPublicationAction(
  productIds: string[],
  status: "PUBLISHED" | "DRAFT" | "HIDDEN",
): Promise<ActionState> {
  await requireAdmin();

  await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: {
      publicationStatus: status,
      ...(status === "PUBLISHED" ? { publishedAt: new Date() } : {}),
    },
  });

  await bumpCatalogVersion();
  revalidatePath("/admin/products");
  revalidatePath("/");

  const label =
    status === "PUBLISHED" ? "已发布" : status === "HIDDEN" ? "已隐藏" : "已转为草稿";
  return { ok: true, message: `${productIds.length} 个商品${label}` };
}

/**
 * 删除展示商品。
 *
 * 只删本站的展示记录，不动小铺那边——小铺没有删除接口，
 * 而且删掉别人店里的商品也不该是这个系统的职责。
 */
export async function deleteProductsAction(
  productIds: string[],
): Promise<ActionState> {
  await requireAdmin();

  await prisma.product.deleteMany({ where: { id: { in: productIds } } });

  await bumpCatalogVersion();
  revalidatePath("/admin/products");
  revalidatePath("/");
  return { ok: true, message: `已删除 ${productIds.length} 个商品` };
}

/**
 * 取消对接：解除展示商品与货源的绑定。
 * 展示内容保留，但不再自动同步，变成一个手工商品。
 */
export async function unlinkSourceAction(
  productId: string,
): Promise<ActionState> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { sourceProductId: true },
  });

  if (!product?.sourceProductId) {
    return { error: "该商品没有绑定货源" };
  }

  await prisma.product.update({
    where: { id: productId },
    data: { sourceProductId: null },
  });

  revalidatePath("/admin/products");
  return {
    ok: true,
    message: "已取消对接，该商品不再自动同步（展示内容已保留）",
  };
}

/** 手动刷新。 */
export async function refreshProductsAction(
  productIds: string[],
): Promise<ActionState> {
  await requireAdmin();

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, sourceProductId: { not: null } },
    select: { sourceProductId: true },
  });

  if (products.length === 0) {
    return { error: "所选商品都没有绑定货源，无法刷新" };
  }

  // 单个商品直接同步执行，让用户马上看到结果；批量则排队。
  if (products.length === 1 && products[0]?.sourceProductId) {
    const outcome = await refreshSourceProduct(
      products[0].sourceProductId,
      "MANUAL",
    );
    revalidatePath("/admin/products");
    return outcome.ok
      ? { ok: true, message: "已刷新" }
      : { error: `刷新失败：${outcome.error}（已保留上次可信状态）` };
  }

  let queued = 0;
  for (const product of products) {
    if (!product.sourceProductId) continue;
    const added = await enqueueRefresh({
      sourceProductId: product.sourceProductId,
      trigger: "MANUAL",
      scope: "PRICE_STOCK_STATUS",
    });
    if (added) queued += 1;
  }

  revalidatePath("/admin/products");
  return {
    ok: true,
    message: `已提交 ${queued} 个刷新任务，同步进程会尽快处理`,
  };
}

/**
 * 批量打标签（spec §17.4 的批量操作）。
 *
 * add/remove 会保留各商品已有的其他标签 —— 批量操作不该把别人的标签冲掉。
 */
export async function bulkTagAction(
  productIds: string[],
  operation: "add" | "remove" | "replace",
  tags: string[],
): Promise<ActionState> {
  await requireAdmin();

  const incoming = normalizeTags(tags);
  if (incoming.length === 0 && operation !== "replace") {
    return { error: "请先输入标签" };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, tags: true },
  });

  // 每个商品的标签不同，只能逐条更新；用事务保证要么全成要么全不动。
  await prisma.$transaction(
    products.map((product) =>
      prisma.product.update({
        where: { id: product.id },
        data: {
          tags: serializeTags(
            applyTagOperation(parseTags(product.tags), operation, incoming),
          ),
        },
      }),
    ),
  );

  await bumpCatalogVersion();
  revalidatePath("/admin/products");

  const verb =
    operation === "add" ? "添加" : operation === "remove" ? "移除" : "替换";
  return { ok: true, message: `已为 ${products.length} 个商品${verb}标签` };
}

/**
 * 按标题自动打标签。
 *
 * 几百个商品手工打标签太累，先按标题里的关键词提一批候选
 * （质保/官方/直充/月卡/美区…），标错了再手工调。
 */
export async function autoTagAction(
  productIds: string[],
): Promise<ActionState> {
  await requireAdmin();

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, title: true, tags: true },
  });

  let tagged = 0;
  const updates = products.flatMap((product) => {
    const suggested = suggestTags(product.title);
    if (suggested.length === 0) return [];

    tagged += 1;
    return [
      prisma.product.update({
        where: { id: product.id },
        data: {
          tags: serializeTags(
            applyTagOperation(parseTags(product.tags), "add", suggested),
          ),
        },
      }),
    ];
  });

  if (updates.length > 0) await prisma.$transaction(updates);

  await bumpCatalogVersion();
  revalidatePath("/admin/products");
  return {
    ok: true,
    message:
      tagged > 0
        ? `已为 ${tagged} 个商品自动添加标签`
        : "没有识别出可用的标签",
  };
}

/** 批量设置分类。 */
export async function bulkCategoryAction(
  productIds: string[],
  categoryId: string | null,
): Promise<ActionState> {
  await requireAdmin();

  await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: { categoryId },
  });

  await bumpCatalogVersion();
  revalidatePath("/admin/products");
  return {
    ok: true,
    message: categoryId
      ? `已为 ${productIds.length} 个商品设置分类`
      : `已清除 ${productIds.length} 个商品的分类`,
  };
}
