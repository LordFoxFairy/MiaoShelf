import { describe, expect, it } from "vitest";
import { parseShopUrl } from "@/lib/connectors/ldxp-shop/connector";

/**
 * 公开店铺连接器的 token 解析。
 *
 * token 就是店铺地址里的那段路径，不是密钥——
 * 这也是这条路不需要账号密码的原因。
 */
describe("parseShopUrl", () => {
  it("从标准店铺地址解析出 token", () => {
    expect(parseShopUrl("https://pay.ldxp.cn/shop/miaoli")).toEqual({
      apiBase: "https://pay.ldxp.cn",
      token: "miaoli",
    });
  });

  it("忽略结尾斜杠", () => {
    expect(parseShopUrl("https://pay.ldxp.cn/shop/miaoli/")).toEqual({
      apiBase: "https://pay.ldxp.cn",
      token: "miaoli",
    });
  });

  it("忽略查询参数", () => {
    expect(parseShopUrl("https://pay.ldxp.cn/shop/miaoli?from=wx")).toEqual({
      apiBase: "https://pay.ldxp.cn",
      token: "miaoli",
    });
  });

  it("支持自建域名的店铺", () => {
    // 平台允许自定义域名，apiBase 要跟着变。
    expect(parseShopUrl("https://shop.example.com/shop/abc")).toEqual({
      apiBase: "https://shop.example.com",
      token: "abc",
    });
  });

  it("没有 /shop/ 时取最后一段作为 token", () => {
    expect(parseShopUrl("https://pay.ldxp.cn/miaoli")).toEqual({
      apiBase: "https://pay.ldxp.cn",
      token: "miaoli",
    });
  });

  it("畸形地址返回 null，而不是抛异常", () => {
    expect(parseShopUrl("not a url")).toBeNull();
  });

  it("只有域名没有路径时返回 null", () => {
    // 没有 token 就没法查任何东西，早点报错比后面 500 好。
    expect(parseShopUrl("https://pay.ldxp.cn")).toBeNull();
  });
});
