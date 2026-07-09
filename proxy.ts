import { NextRequest, NextResponse } from "next/server";

/**
 * 后台最低鉴权:
 * - 未设置 ADMIN_TOKEN 环境变量 → 不鉴权(开发默认,兼容旧部署)
 * - 设置后: /admin 与 /api/* 需 Cookie admin_token=... 或 Header x-admin-token
 * - 登录页 /login 与 POST /api/auth/login 放行
 */
export function proxy(req: NextRequest) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/auth/login") {
    return NextResponse.next();
  }
  if (!pathname.startsWith("/admin") && !pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("admin_token")?.value;
  const header = req.headers.get("x-admin-token");
  if (cookie === token || header === token) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ ok: false, error: "未授权" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/login"],
};
