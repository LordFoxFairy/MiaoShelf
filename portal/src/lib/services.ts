/**
 * 站点内容清单。
 *
 * 加东西只动这个文件，布局代码不用碰：
 *   - 新增一个工具 → 往 SECTIONS 里对应分区的 items 加一条
 *   - 新增一个分区（比如「教程」）→ 往 SECTIONS 加一项，空的会自动隐藏
 *
 * 分区之所以要分开而不是全塞进「配套工具」：JSON 转换是自助工具，
 * API 中转是需要开通的服务，教程是内容——三者性质不同，
 * 混在一起访客分不清哪个能直接用。
 */

export interface Item {
  name: string;
  /** 一句话说清对访客的价值，不写自我描述。 */
  desc: string;
  /** 留空表示还没上线，渲染成灰色占位。 */
  url: string;
  color: string;
  /** 内联 SVG path，24×24 viewBox。 */
  icon: string;
  /** 状态标签，如「免费用」「暂不开放」。 */
  tag?: string;
  /** 受限：能点但不对外开放，视觉上要区分，免得访客以为站坏了。 */
  restricted?: boolean;
}

export interface Section {
  id: string;
  /** 分区标题。 */
  title: string;
  /** 副标题，说清这一区是干什么的；没有就不显示。 */
  hint?: string;
  items: readonly Item[];
}

export const SECTIONS: readonly Section[] = [
  {
    id: "tools",
    title: "工具箱",
    hint: "打开就能用，不需要账号",
    items: [
      {
        name: "JSON 转换",
        desc: "ChatGPT 会话转 CPA / sub2api / Codex 等格式",
        url: "https://convert.miaokit.cloud",
        color: "#10a37f",
        tag: "免费用",
        icon: "M8 3 4 7l4 4M16 21l4-4-4-4M14 4l-4 16",
      },
    ],
  },
  {
    id: "services",
    title: "服务",
    hint: "需要开通后使用",
    items: [
      {
        name: "API 中转",
        desc: "统一入口转发各家模型接口",
        url: "https://api.miaokit.cloud",
        color: "#8b5cf6",
        tag: "暂不开放",
        restricted: true,
        icon: "M4 12h16M4 12l4-4M4 12l4 4M20 6v12",
      },
    ],
  },
  {
    id: "guides",
    title: "教程",
    hint: "怎么买、怎么用",
    // 还没写，整个分区会自动隐藏——留着结构，写了就显示
    items: [],
  },
];

/** 商品站与下单入口——主推。 */
export const SHOP_URL = "https://shop.miaokit.cloud";
export const STORE_URL = "https://pay.ldxp.cn/shop/miaoli";
/** 商品数据，Hero 里的实时数字和商品条都从这儿来。 */
export const CATALOG_URL = "https://shop.miaokit.cloud/products.json";
