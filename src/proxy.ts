import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * 后台访问保护 + 缓存头（spec §13.6、§20）。
 *
 * 这里只做"有没有合法签名"的粗筛，具体用户信息由页面自己再读一次。
 * middleware 跑在每个请求上，不适合查数据库。
 */

const PROTECTED_PREFIXES = ["/admin", "/api/admin"];

/** 健康检查必须匿名可访问，不能被重定向到登录页。 */
const SELF_GUARDED = ["/api/health"];

/** 这些路径绝不能被 Cloudflare 或浏览器缓存。 */
const NO_STORE_PREFIXES = [
  "/admin",
  "/api/admin",
  "/go/",
  "/login",
];

/** 前台可缓存页面。 */
function isPublicPage(pathname: string): boolean {
  if (pathname === "/") return true;
  return /^\/(products|category|search)(\/|$)/.test(pathname);
}

function isNoStore(pathname: string): boolean {
  if (NO_STORE_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // 状态与点击确认接口必须实时（spec §13.6）
  return /^\/api\/public\/products\/[^/]+\/(status|resolve|view)$/.test(
    pathname,
  );
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get("catalog_session")?.value;
  if (!token) return false;

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return false;

  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const selfGuarded = SELF_GUARDED.some((p) => pathname.startsWith(p));

  if (!selfGuarded && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (!(await hasValidSession(request))) {
      // API 返回 401，页面跳登录并记住原本要去哪。
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "未登录" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }

      const loginUrl = new URL("/login", request.url);
      if (pathname !== "/admin") {
        loginUrl.searchParams.set("next", `${pathname}${search}`);
      }
      return NextResponse.redirect(loginUrl);
    }
  }

  const response = NextResponse.next();

  if (isNoStore(pathname)) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  } else if (isPublicPage(pathname)) {
    /*
     * 前台页面按需渲染（构建时没有数据库可读），缓存交给 CDN 做。
     * s-maxage 让 Cloudflare 缓存，stale-while-revalidate 让它在后台
     * 更新的同时先返回旧页面，用户不用等。
     *
     * 库存状态不吃这个缓存 —— 它由页面里的 LiveStatus 组件单独拉取。
     */
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 跳过静态资源，否则每个 JS/CSS 请求都要跑一遍鉴权。
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
