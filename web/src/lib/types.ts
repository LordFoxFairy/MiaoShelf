/**
 * 商品数据契约。
 *
 * 这份结构由本机的 `pnpm build:static` 生成并推送到 /products.json，
 * 前端在运行时 fetch 它。所以**前端只部署一次**，之后每次同步只覆盖这一个
 * JSON 文件即可，不用重新构建整站。
 *
 * 采集端（scripts/build-static.ts）写入时必须保持这里的字段名一致。
 */

export interface Product {
  externalId: string;
  title: string;
  imageUrl: string | null;
  /** 接口给的是字符串，保持原样，展示时再格式化。 */
  price: string | null;
  stockCount: number | null;
  availabilityHint: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | string;
  /** 商品详情页地址，点击卡片跳转过去。 */
  url: string;
  /** 分类名，采集端从原始数据里取出来铺平。 */
  category: string;
  /**
   * 小铺自带的一级大类：card=卡密、equity=权益。
   * 这是货源平台本来就有的划分，前端顶部按它切换。
   */
  goodsType: string;
}

/** 一级大类的展示名——货源平台用的是英文 key。 */
export const GOODS_TYPE_LABEL: Record<string, string> = {
  card: "卡密",
  equity: "权益",
};

export interface Catalog {
  shopName: string | null;
  /** ISO 时间戳，展示时转成本地时间。 */
  updatedAt: string;
  items: Product[];
}

/** 按分类分组后的视图模型。 */
export interface CategoryGroup {
  name: string;
  slug: string;
  items: Product[];
}
