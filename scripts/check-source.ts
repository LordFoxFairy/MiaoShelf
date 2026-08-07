/**
 * 货源连通性诊断。
 *
 *   pnpm check-source                                 直连测试
 *   SOURCE_HTTP_PROXY=http://ip:port pnpm check-source  走代理测试
 *
 * 用来快速判断「能不能访问货源」，以及代理配置对不对。
 * 部署到新服务器时先跑这个，比部署完再排查省事。
 */
import { getSourceFetch, proxyLabel } from "@/lib/connectors/proxy-fetch";

const SHOP_URL = process.env.CHECK_SHOP_URL ?? "https://pay.ldxp.cn/shop/miaoli";

async function main() {
  const token = new URL(SHOP_URL).pathname.split("/").filter(Boolean).pop();
  const origin = new URL(SHOP_URL).origin;

  console.log("店铺:", SHOP_URL);
  console.log("出口:", proxyLabel() ?? "直连（未配置代理）");
  console.log("");

  const doFetch = getSourceFetch();

  // 先看出口 IP，方便你判断代理是否真的生效
  try {
    const ipRes = await doFetch("https://api.ipify.org?format=json");
    const ip = (await ipRes.json()) as { ip?: string };
    console.log("出口 IP:", ip.ip ?? "未知");
  } catch {
    console.log("出口 IP: 查询失败（不影响下面的测试）");
  }

  console.log("");
  console.log("正在请求货源接口…");

  try {
    const response = await doFetch(`${origin}/shopApi/Shop/info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Origin: origin,
        Referer: SHOP_URL,
      },
      body: JSON.stringify({ token }),
    });

    const text = await response.text();

    if (/^\s*<(!doctype|html)/i.test(text.slice(0, 80))) {
      const isWaf = /_waf_|waf_is_mobile/i.test(text.slice(0, 2000));
      console.log("");
      console.log("✗ 失败：返回的是 HTML 而不是 JSON");
      console.log(
        isWaf
          ? "  原因：被货源平台的访问保护拦截（WAF 挑战页）"
          : "  原因：返回了网页，可能是登录页或错误页",
      );
      console.log("");
      console.log("  怎么办：");
      console.log("   1. 换一台服务器试试（IP 段被标记是最常见原因）");
      console.log("   2. 配置代理出口：");
      console.log("      在 .env 里加 SOURCE_HTTP_PROXY=http://用户:密码@地址:端口");
      console.log("      然后重新跑这个命令验证");
      process.exit(1);
    }

    const json = JSON.parse(text) as { code?: number; data?: { nickname?: string } };
    if (Number(json.code) !== 1) {
      console.log("");
      console.log("✗ 接口返回业务错误，code =", json.code);
      process.exit(1);
    }

    console.log("");
    console.log("✓ 连接正常");
    console.log("  店铺名称:", json.data?.nickname ?? "（未返回）");

    // 顺便看看能拿到多少商品
    const listRes = await doFetch(`${origin}/shopApi/Shop/goodsList`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Referer: SHOP_URL,
      },
      body: JSON.stringify({
        token,
        goods_type: "card",
        current: 1,
        pageSize: 5,
        keywords: "",
        category_id: "",
      }),
    });
    const list = (await listRes.json()) as { data?: { total?: number } };
    console.log("  卡密商品数:", list.data?.total ?? "未知");
    console.log("");
    console.log("可以正常同步。");
  } catch (error) {
    console.log("");
    console.log("✗ 请求失败:", error instanceof Error ? error.message : error);
    console.log("");
    console.log("  如果配了代理，检查代理地址是否正确、是否可用。");
    process.exit(1);
  }
}

main();
