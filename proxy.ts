import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqualStr } from "@/lib/auth"

/**
 * 后台最低鉴权:
 * - 未设置 ADMIN_TOKEN → 开发放行;生产 fail-closed:全部 403。
 *   此前是「未设即不鉴权」——生产一旦漏配,日志/聊天记录/改配置/重启
 *   runtime 全部静默公开;拒绝服务优于静默裸奔。
 * - 设置后: /admin 与 /api/* 需 Cookie admin_token=... 或 Header x-admin-token
 * - 登录页 /login 与 POST /api/auth/login 放行
 */
export function proxy(req: NextRequest) {
  const token = process.env.ADMIN_TOKEN
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      const msg =
        "生产环境未设置 ADMIN_TOKEN,后台拒绝服务。请在环境变量配置 ADMIN_TOKEN 后重启。"
      if (req.nextUrl.pathname.startsWith("/api")) {
        return NextResponse.json({ ok: false, error: msg }, { status: 403 })
      }
      return new NextResponse(msg, { status: 503 })
    }
    return NextResponse.next()
  }

  const { pathname } = req.nextUrl
  if (pathname === "/login" || pathname === "/api/auth/login") {
    return NextResponse.next()
  }
  if (!pathname.startsWith("/admin") && !pathname.startsWith("/api")) {
    return NextResponse.next()
  }

  const cookie = req.cookies.get("admin_token")?.value
  const header = req.headers.get("x-admin-token")
  if (
    (cookie != null && timingSafeEqualStr(cookie, token)) ||
    (header != null && timingSafeEqualStr(header, token))
  ) {
    return NextResponse.next()
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ ok: false, error: "未授权" }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = "/login"
  url.searchParams.set("from", pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/login"],
}
