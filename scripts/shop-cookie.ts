/**
 * 本机取 WAF 放行 cookie —— 服务器换 IP 无望时的正解。
 *
 *   pnpm shop-cookie                                   打印 cookie，你复制到服务器
 *   pnpm shop-cookie --account <id>                    直接存进该账号的加密凭据
 *   SHOP_URL=https://pay.ldxp.cn/shop/xxx pnpm shop-cookie
 *
 * 在你**有屏幕的本机**跑：弹出真浏览器，让它把 WAF 挑战跑过去
 * （多半自动过；真弹滑块你就手动滑，程序一直等）。过关后导出放行 cookie
 * （acw_tc/cdn_sec_tc/PHPSESSID）。服务器带上这串 cookie，无头纯 HTTP 也能采，
 * 不用在服务器上跑浏览器、更不用滑 iframe。
 *
 * cookie 有时效（acw_tc 会过期）。服务器采集撞回挑战页时，回本机再跑一次刷新。
 */
import { grabWafCookie } from "@/lib/connectors/ldxp-shop/browser-collector";
import { parseShopUrl } from "@/lib/connectors/ldxp-shop/connector";

const SHOP_URL = process.env.SHOP_URL ?? "https://pay.ldxp.cn/shop/miaoli";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const parsed = parseShopUrl(SHOP_URL);
  if (!parsed) {
    console.error("店铺地址无法解析：", SHOP_URL);
    process.exit(1);
  }

  const accountId = argValue("--account");

  console.log("店铺:", SHOP_URL);
  console.log("即将弹出浏览器过 WAF —— 有滑块就手动滑，程序会一直等你。");
  console.log("");

  // 默认有头（好让你手动滑）；HEADLESS=1 时无头，用于 WAF 能自动过的环境/自检。
  const headless = process.env.HEADLESS === "1";
  const { cookie, shopName } = await grabWafCookie({
    apiBase: parsed.apiBase,
    token: parsed.token,
    profilePath:
      process.env.SHOP_COOKIE_PROFILE ?? "./data/browser-profiles/shop-cookie",
    headless,
    manual: !headless, // 无头没法手动，就不等
    manualTimeoutMs: 0,
  });

  console.log("");
  console.log("✓ 过关，店铺:", shopName ?? "（未取到名字）");
  console.log("");

  if (accountId) {
    // 存进已有加密凭据（复用登录会话那套 saveSession，字段就是 cookie）。
    const { saveSession } = await import("@/lib/source-credentials");
    await saveSession(accountId, { cookie });
    console.log(`✓ 已存进账号 ${accountId} 的凭据（encryptedCookie）。`);
    console.log("  服务器同步会自动带上它。过期了回本机重跑本命令即可刷新。");
  } else {
    console.log("把下面这行 cookie 存到服务器（.env 或该账号凭据）：");
    console.log("");
    console.log(cookie);
    console.log("");
    console.log("要直接写进某账号凭据，加 --account <账号ID> 重跑本命令。");
  }
}

main().catch((error) => {
  console.error("");
  console.error("✗ 取 cookie 失败:", error instanceof Error ? error.message : error);
  process.exit(1);
});
