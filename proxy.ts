import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqualStr } from "@/lib/core/auth"
import {
  contentLengthExceeds,
  isMutatingMethod,
  isSameOriginRequest,
  MAX_REQUEST_BODY_BYTES,
} from "@/lib/core/http-security"

function expectedOrigin(req: NextRequest): string | undefined {
  if (process.env.TRUST_PROXY !== "true") {
    // `next start -H 0.0.0.0` can make `nextUrl.origin` use the bind
    // address, while the browser uses the Host it requested (localhost or a
    // LAN name). Host is still checked against the request's own protocol;
    // forwarded host/proto are only trusted in the explicit proxy mode below.
    const host = req.headers.get("host")?.split(",")[0]?.trim()
    if (host) {
      try {
        return new URL(`${req.nextUrl.protocol}//${host}`).origin
      } catch {
        // Fall back to Next's parsed origin for malformed Host headers.
      }
    }
    return req.nextUrl.origin
  }
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.nextUrl.host
  const protocol =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    req.nextUrl.protocol.replace(/:$/, "")
  if (!host || (protocol !== "http" && protocol !== "https")) {
    return req.nextUrl.origin
  }
  try {
    return new URL(`${protocol}://${host}`).origin
  } catch {
    return req.nextUrl.origin
  }
}

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
  const { pathname } = req.nextUrl
  const protectedPath =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api") ||
    pathname === "/login"
  if (!protectedPath) return NextResponse.next()

  // Reject an advertised oversized body before Next/proxy buffers or a route
  // parses it. Route handlers also use the bounded reader for chunked bodies.
  if (
    (pathname.startsWith("/api") || pathname.startsWith("/admin")) &&
    isMutatingMethod(req.method) &&
    contentLengthExceeds(req.headers, MAX_REQUEST_BODY_BYTES)
  ) {
    return NextResponse.json(
      { ok: false, error: "请求体过大" },
      { status: 413 }
    )
  }

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

  if (
    (pathname === "/login" &&
      (req.method === "GET" || req.method === "HEAD")) ||
    (pathname === "/api/auth/login" && req.method === "POST")
  ) {
    if (
      pathname === "/api/auth/login" &&
      (req.headers.has("origin") || req.headers.has("referer")) &&
      !isSameOriginRequest(req, expectedOrigin(req))
    ) {
      return NextResponse.json(
        { ok: false, error: "跨站请求被拒绝" },
        { status: 403 }
      )
    }
    return NextResponse.next()
  }
  const cookie = req.cookies.get("admin_token")?.value
  const header = req.headers.get("x-admin-token")
  const cookieAuth = cookie != null && timingSafeEqualStr(cookie, token)
  const headerAuth = header != null && timingSafeEqualStr(header, token)
  if (headerAuth) return NextResponse.next()
  if (cookieAuth) {
    // A browser cookie is ambient authority. Mutations must prove that they
    // came from this origin; explicit x-admin-token clients are non-cookie
    // callers and are handled above.
    if (
      isMutatingMethod(req.method) &&
      !isSameOriginRequest(req, expectedOrigin(req))
    ) {
      return NextResponse.json(
        { ok: false, error: "跨站请求被拒绝" },
        { status: 403 }
      )
    }
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
