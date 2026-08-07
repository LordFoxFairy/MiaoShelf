/**
 * 链动小铺（LDXP）接口定义。
 *
 * 字段名全部来自对 miku1130/ldxp-merchant-toolkit 源码的实测核对，
 * 不是猜的。改动前请先确认真实响应。
 *
 * 注意：这些是站内接口，随时可能变。所有解析都用宽松模式，
 * 缺字段不能让整批导入失败，未知字段一律保留到 rawPayload。
 */

export const LDXP_API = {
  /** 货源广场搜索 */
  sourceSearch: "/merchantApi/MyParent/searchGoodsList",
  /** 一键对接货源（写操作，默认关闭） */
  sourceConnect: "/merchantApi/MyParent/fetchConnectGoods",
  /** 我的商品列表 */
  goodsList: "/merchantApi/Goods/list",
  /** 商品详情 */
  goodsInfo: "/merchantApi/Goods/info",
  /** 更新商品（写操作，必须整包提交） */
  goodsUpdate: "/merchantApi/Goods/update",
  /** 上下架（写操作） */
  goodsStatus: "/merchantApi/Goods/statusUpdate",
  /** 分类树 */
  categoryList: "/merchantApi/GoodsCategory/listAll",
  /** 获取跳转链接 */
  goodsLink: "/merchantApi/Goods/getLink",
  /** 取消对接货源（写操作） */
  sourceDisconnect: "/merchantApi/MyParent/disconnectGoods",
  /** 货源分类 */
  sourceCategory: "/merchantApi/MyParent/goodsCategory",
  /** 账号信息，用于验证会话 */
  userInfo: "/merchantApi/user/userinfo",
} as const;

/** 商品类型。stock_count 只对 card 有意义，其余类型"无需库存"。 */
export const GOODS_TYPES = {
  card: "卡密",
  article: "知识",
  resource: "资源",
  equity: "权益",
} as const;

export type GoodsType = keyof typeof GOODS_TYPES;

/**
 * status 是整数：1=销售中，0=仓库中。
 * 999 是查询用的哨兵值（"全部"），不是真实状态。
 */
export const LDXP_STATUS = {
  ON_SALE: 1,
  IN_WAREHOUSE: 0,
  /** 仅用于查询参数 */
  QUERY_ALL: 999,
} as const;

/** 默认分页大小。源码里搜索固定 50。 */
export const DEFAULT_PAGE_SIZE = 50;
