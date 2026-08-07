import { z } from "zod";
import {
  Availability,
  PriceMode,
  PublicationStatus,
  RefreshScope,
  RefreshTrigger,
  SourceStatus,
  SyncStatus,
} from "@/lib/enums";

/** 所有 API 入参都过 Zod（spec §20）。 */

const enumOf = <T extends Record<string, string>>(e: T) =>
  z.enum(Object.values(e) as [string, ...string[]]);

export const publicationStatusSchema = enumOf(PublicationStatus);
export const sourceStatusSchema = enumOf(SourceStatus);
export const availabilitySchema = enumOf(Availability);
export const syncStatusSchema = enumOf(SyncStatus);
export const priceModeSchema = enumOf(PriceMode);
export const refreshTriggerSchema = enumOf(RefreshTrigger);
export const refreshScopeSchema = enumOf(RefreshScope);

/** slug 只允许小写字母数字和连字符，避免和路由/缓存 key 冲突。 */
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只能包含小写字母、数字和连字符");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 公开商品列表查询（spec §19）。 */
export const publicProductQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  category: slugSchema.optional(),
  availability: availabilitySchema.optional(),
  sort: z.enum(["latest", "price_asc", "price_desc", "featured"]).default("featured"),
});
export type PublicProductQuery = z.infer<typeof publicProductQuerySchema>;

/** 管理端登录。 */
export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

/** 货源账号创建/更新。密码等敏感字段是 write-only，永不回传。 */
export const sourceAccountCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url(),
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  isEnabled: z.boolean().default(true),
});

export const sourceAccountUpdateSchema = sourceAccountCreateSchema
  .partial()
  .omit({ password: true })
  .extend({
    password: z.string().min(1).max(200).optional(),
  });

/** 会话导入（spec §10.3）。 */
export const sessionImportSchema = z.object({
  pairingCode: z.string().trim().min(6).max(64),
  cookie: z.string().trim().min(1).max(8000),
  merchantToken: z.string().trim().max(4000).optional(),
});

/** 货源搜索（spec §11.1）。 */
export const sourceSearchSchema = paginationSchema.extend({
  keywords: z.string().trim().max(100).optional(),
  goodsType: z.string().trim().max(40).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  inStockOnly: z.coerce.boolean().optional(),
  importedFilter: z.enum(["all", "imported", "not_imported"]).default("all"),
});
export type SourceSearchInput = z.infer<typeof sourceSearchSchema>;

/** 批量导入货源为草稿。 */
export const sourceImportSchema = z.object({
  externalIds: z.array(z.string().min(1)).min(1).max(200),
});

/** 展示商品编辑。同步不得覆盖这些字段（spec §6.2）。 */
export const productUpdateSchema = z.object({
  slug: slugSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  subtitle: z.string().trim().max(300).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  coverUrl: z.string().url().nullable().optional(),
  gallery: z.array(z.string().url()).max(20).optional(),
  priceMode: priceModeSchema.optional(),
  priceAdjustment: z.coerce.number().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  buttonText: z.string().trim().min(1).max(40).optional(),
  targetUrlOverride: z.string().url().nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
  featured: z.boolean().optional(),
  manualLock: z.boolean().optional(),
  autoHideWhenOutOfStock: z.boolean().optional(),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(400).nullable().optional(),
});

export const batchRefreshSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * 外部接口响应做宽松解析（spec §9.1）：
 * 字段随时可能变，未知字段一律保留到 rawPayload，
 * 缺字段不能让整批导入失败。
 */
export const ldxpEnvelopeSchema = z.object({
  code: z.coerce.number(),
  data: z.unknown().optional(),
  msg: z.string().optional().default(""),
});

export const ldxpGoodsSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().optional(),
    goods_type: z.string().optional(),
    cost_price: z.union([z.string(), z.number()]).optional(),
    agent_price_limit: z.union([z.string(), z.number()]).optional(),
    agent_price1: z.union([z.string(), z.number()]).optional(),
    stock_count: z.union([z.string(), z.number()]).nullable().optional(),
    status: z.union([z.string(), z.number()]).optional(),
    link: z.string().optional(),
    short_link: z.string().optional(),
    extend: z
      .object({
        stock_count: z.union([z.string(), z.number()]).nullable().optional(),
      })
      .passthrough()
      .optional(),
    user: z.object({ nickname: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export type LdxpGoods = z.infer<typeof ldxpGoodsSchema>;
