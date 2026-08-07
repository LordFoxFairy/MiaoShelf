import { describe, expect, it } from "vitest";
import { Availability, SourceStatus } from "@/lib/enums";
import {
  flattenCategories,
  isConnected,
  normalizeGoods,
  resolveCategoryId,
  resolveCostPrice,
  resolveSourceStatus,
  resolveStock,
} from "@/lib/connectors/ldxp/mapping";

/**
 * 这些测试锁住的是小铺接口的真实怪癖。
 * 如果哪天有人"顺手简化"了映射逻辑，这里会立刻炸。
 */

describe("resolveCostPrice —— 成本价是优先级链", () => {
  it("有 cost_price 时优先用它", () => {
    expect(
      resolveCostPrice({ cost_price: "12.30", agent_price1: "99" })?.toFixed(2),
    ).toBe("12.30");
  });

  it("cost_price 缺失时回落到 agent_price_limit", () => {
    // 真实响应里 cost_price 经常不存在，只读它会得到一堆无价商品。
    expect(
      resolveCostPrice({ agent_price_limit: "45.5" })?.toFixed(2),
    ).toBe("45.50");
  });

  it("逐级回落到 agent_price1/2/3", () => {
    expect(resolveCostPrice({ agent_price2: "7" })?.toFixed(2)).toBe("7.00");
    expect(resolveCostPrice({ agent_price3: "8" })?.toFixed(2)).toBe("8.00");
  });

  it("跳过 null 继续找下一个", () => {
    expect(
      resolveCostPrice({
        cost_price: null,
        agent_price_limit: null,
        agent_price1: "19.9",
      })?.toFixed(2),
    ).toBe("19.90");
  });

  it("价格 0 是合法值，不能当成缺失", () => {
    expect(resolveCostPrice({ cost_price: 0 })?.toFixed(2)).toBe("0.00");
  });

  it("全都没有时返回 null，而不是 0", () => {
    // 返回 0 会让前台显示"¥0.00"，用户以为免费。
    expect(resolveCostPrice({})).toBeNull();
  });

  it("字符串和数字都能解析", () => {
    expect(resolveCostPrice({ cost_price: 12.3 })?.toFixed(2)).toBe("12.30");
    expect(resolveCostPrice({ cost_price: "12.30" })?.toFixed(2)).toBe("12.30");
  });
});

describe("resolveStock —— 两个库存字段都要读", () => {
  it("优先读顶层 stock_count", () => {
    expect(resolveStock({ stock_count: 42 }, "card")).toBe(42);
  });

  it("顶层缺失时读 extend.stock_count", () => {
    // 小铺两处代码优先级不一致，两个字段都得支持。
    expect(resolveStock({ extend: { stock_count: 7 } }, "card")).toBe(7);
  });

  it("库存 0 要如实返回，不能当成缺失", () => {
    expect(resolveStock({ stock_count: 0 }, "card")).toBe(0);
  });

  it("非卡密商品不跟踪库存，返回 null 表示不限量", () => {
    expect(resolveStock({ stock_count: 0 }, "equity")).toBeNull();
    expect(resolveStock({}, "article")).toBeNull();
  });

  it("两个字段都没有时返回 undefined —— 查不到，不是没货", () => {
    // 这个区分很关键：undefined 会让上层走"无法确认"，
    // 如果错误地返回 0，商品会被误判为缺货。
    expect(resolveStock({}, "card")).toBeUndefined();
  });
});

describe("resolveSourceStatus", () => {
  it("1 = 销售中", () => {
    expect(resolveSourceStatus({ status: 1 })).toBe(SourceStatus.ACTIVE);
  });

  it("0 = 仓库中（已下架）", () => {
    expect(resolveSourceStatus({ status: 0 })).toBe(SourceStatus.INACTIVE);
  });

  it("字符串形式也能识别", () => {
    expect(resolveSourceStatus({ status: "1" })).toBe(SourceStatus.ACTIVE);
  });

  it("认不出来的值返回 UNKNOWN，绝不猜成下架", () => {
    // 猜错方向就是把在售商品从前台抹掉。
    expect(resolveSourceStatus({ status: 7 })).toBe(SourceStatus.UNKNOWN);
    expect(resolveSourceStatus({})).toBe(SourceStatus.UNKNOWN);
  });
});

describe("isConnected —— child 有值表示已对接", () => {
  it("child 有对象时算已对接", () => {
    expect(isConnected({ child: { id: 1 } })).toBe(true);
  });

  it("child 为空时算未对接", () => {
    expect(isConnected({ child: null })).toBe(false);
    expect(isConnected({})).toBe(false);
  });
});

describe("normalizeGoods", () => {
  it("完整映射一个货源搜索结果", () => {
    const result = normalizeGoods(
      {
        id: 12345,
        name: "ChatGPT Plus 会员",
        goods_type: "card",
        cost_price: "128.00",
        stock_count: 42,
        status: 1,
        link: "https://www.ldxp.cn/goods/12345",
      },
      { lowStockThreshold: 5 },
    );

    expect(result.externalId).toBe("12345");
    expect(result.title).toBe("ChatGPT Plus 会员");
    expect(result.price?.toFixed(2)).toBe("128.00");
    expect(result.stockCount).toBe(42);
    expect(result.sourceStatus).toBe(SourceStatus.ACTIVE);
    expect(result.availabilityHint).toBe(Availability.IN_STOCK);
  });

  it("低于阈值时标记库存紧张", () => {
    const result = normalizeGoods(
      { id: 1, stock_count: 3, goods_type: "card" },
      { lowStockThreshold: 5 },
    );
    expect(result.availabilityHint).toBe(Availability.LOW_STOCK);
  });

  it("库存字段缺失时不给状态提示，交给上层判断", () => {
    const result = normalizeGoods(
      { id: 1, goods_type: "card" },
      { lowStockThreshold: 5 },
    );
    expect(result.availabilityHint).toBeNull();
  });

  it("id 是数字时转成字符串，保证和数据库一致", () => {
    const result = normalizeGoods({ id: 999 }, { lowStockThreshold: 5 });
    expect(result.externalId).toBe("999");
  });

  it("原始对象完整保留到 raw", () => {
    // 字段随时会变，先全存下来才有排查的余地。
    const raw = { id: 1, unknown_new_field: "surprise" };
    const result = normalizeGoods(raw, { lowStockThreshold: 5 });
    expect(result.raw).toEqual(raw);
  });
});

describe("flattenCategories —— 节点结构不统一", () => {
  it("支持 value/label 命名", () => {
    expect(flattenCategories([{ value: 1, label: "卡密" }])).toEqual([
      { id: "1", name: "卡密", depth: 0 },
    ]);
  });

  it("支持 id/name 命名", () => {
    expect(flattenCategories([{ id: 2, name: "知识" }])).toEqual([
      { id: "2", name: "知识", depth: 0 },
    ]);
  });

  it("children / child / list 三种子节点写法都支持", () => {
    const viaChildren = flattenCategories([
      { id: 1, name: "父", children: [{ id: 2, name: "子" }] },
    ]);
    const viaChild = flattenCategories([
      { id: 1, name: "父", child: [{ id: 2, name: "子" }] },
    ]);
    const viaList = flattenCategories([
      { id: 1, name: "父", list: [{ id: 2, name: "子" }] },
    ]);

    for (const result of [viaChildren, viaChild, viaList]) {
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({ id: "2", name: "子", depth: 1 });
    }
  });

  it("非数组输入返回空数组而不是抛异常", () => {
    expect(flattenCategories(null)).toEqual([]);
    expect(flattenCategories({})).toEqual([]);
  });
});

describe("resolveCategoryId —— 字段名有六七种写法", () => {
  it("依次尝试各种命名", () => {
    expect(resolveCategoryId({ category_id: 5 })).toBe("5");
    expect(resolveCategoryId({ goods_category_id: 6 })).toBe("6");
    expect(resolveCategoryId({ categoryId: 7 })).toBe("7");
    expect(resolveCategoryId({ cate_id: 8 })).toBe("8");
    expect(resolveCategoryId({ category: { id: 9 } })).toBe("9");
    expect(resolveCategoryId({ category: "10" })).toBe("10");
  });

  it("都没有时返回 null（列表响应经常不带分类）", () => {
    expect(resolveCategoryId({})).toBeNull();
  });
});
