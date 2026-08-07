import { describe, expect, it } from "vitest";
import {
  applyTagOperation,
  countTags,
  normalizeTags,
  parseTags,
  serializeTags,
  suggestTags,
} from "@/lib/tags";

describe("normalizeTags", () => {
  it("去掉首尾空格", () => {
    expect(normalizeTags([" 质保 ", "官方"])).toEqual(["质保", "官方"]);
  });

  it("去重 —— 否则筛选器里会出现两个一样的标签", () => {
    expect(normalizeTags(["热卖", "热卖 ", "热卖"])).toEqual(["热卖"]);
  });

  it("丢掉空字符串", () => {
    expect(normalizeTags(["", "  ", "有效"])).toEqual(["有效"]);
  });

  it("支持中英文逗号分隔的字符串", () => {
    expect(normalizeTags("质保，官方,直充")).toEqual(["质保", "官方", "直充"]);
  });

  it("限制单个标签长度", () => {
    expect(normalizeTags(["a".repeat(30)])).toEqual([]);
  });

  it("限制标签数量 —— 挂太多就失去筛选意义了", () => {
    const many = Array.from({ length: 30 }, (_, i) => `标签${i}`);
    expect(normalizeTags(many)).toHaveLength(12);
  });

  it("非数组非字符串返回空", () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe("parseTags / serializeTags", () => {
  it("往返一致", () => {
    const tags = ["质保", "官方"];
    expect(parseTags(serializeTags(tags))).toEqual(tags);
  });

  it("坏数据返回空数组而不是抛异常", () => {
    expect(parseTags("not json")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('{"a":1}')).toEqual([]);
  });
});

describe("applyTagOperation —— 批量打标签", () => {
  it("add 保留原有标签", () => {
    // 批量加标签不能把别人已有的标签冲掉。
    expect(applyTagOperation(["官方"], "add", ["质保"])).toEqual([
      "官方",
      "质保",
    ]);
  });

  it("add 重复标签不会产生副本", () => {
    expect(applyTagOperation(["官方"], "add", ["官方", "质保"])).toEqual([
      "官方",
      "质保",
    ]);
  });

  it("remove 只删指定的", () => {
    expect(applyTagOperation(["官方", "质保", "直充"], "remove", ["质保"])).toEqual(
      ["官方", "直充"],
    );
  });

  it("remove 不存在的标签是安全的", () => {
    expect(applyTagOperation(["官方"], "remove", ["不存在"])).toEqual(["官方"]);
  });

  it("replace 整个覆盖", () => {
    expect(applyTagOperation(["官方", "质保"], "replace", ["新的"])).toEqual([
      "新的",
    ]);
  });
});

describe("countTags", () => {
  it("按使用次数降序 —— 常用的排前面才好点", () => {
    const result = countTags([
      ["官方", "质保"],
      ["官方"],
      ["官方", "直充"],
      ["质保"],
    ]);

    expect(result[0]).toEqual({ tag: "官方", count: 3 });
    expect(result[1]).toEqual({ tag: "质保", count: 2 });
    expect(result[2]).toEqual({ tag: "直充", count: 1 });
  });

  it("空输入返回空", () => {
    expect(countTags([])).toEqual([]);
  });
});

describe("suggestTags —— 从标题自动提取候选标签", () => {
  it("识别质保和官方", () => {
    const tags = suggestTags("GPT Plus 1个月充值【谷歌官方｜质保掉订阅】");
    expect(tags).toContain("官方");
    expect(tags).toContain("质保");
  });

  it("识别时长", () => {
    expect(suggestTags("百度网盘 超级会员 年卡")).toContain("年卡");
    expect(suggestTags("百度网盘 超级会员 周卡")).toContain("周卡");
    expect(suggestTags("Supergrok Heavy 月卡")).toContain("月卡");
  });

  it("识别地区", () => {
    expect(suggestTags("GPT Plus【IOS官方｜美区】")).toContain("美区");
    expect(suggestTags("Netflix 土耳其账号")).toContain("土区");
  });

  it("识别直充和成品", () => {
    const tags = suggestTags("Supergrok Heavy 月卡(可直充可成品，质保会员到账)");
    expect(tags).toContain("直充");
    expect(tags).toContain("成品");
  });

  it("没有匹配时返回空数组", () => {
    expect(suggestTags("普通商品")).toEqual([]);
  });
});
