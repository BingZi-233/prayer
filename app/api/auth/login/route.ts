import { NextRequest, NextResponse } from "next/server"
import { ok, fail } from "@/lib/core/api"
import {
  clearLoginFails,
  clientIp,
  loginThrottleState,
  recordLoginFail,
  timingSafeEqualStr,
} from "@/lib/core/auth"

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = process.env.ADMIN_TOKEN
  if (!token) {
    return NextResponse.json(
      ok({ auth: false, message: "未启用鉴权(未设置 ADMIN_TOKEN)" })
    )
  }
  // 爆破限速:同 IP 连续 5 次失败锁 15 分钟(此前可无限尝试)
  const ip = clientIp(req.headers)
  const state = loginThrottleState(ip)
  if (state.blocked) {
    const min = Math.ceil((state.retryAfterMs ?? 0) / 60_000)
    return NextResponse.json(fail(`尝试过多,请 ${min} 分钟后再试`), {
      status: 429,
      headers: {
        "retry-after": String(Math.ceil((state.retryAfterMs ?? 0) / 1000)),
      },
    })
  }

  const body = await req.json().catch(() => null)
  const provided = typeof body?.token === "string" ? body.token : ""
  if (!timingSafeEqualStr(provided, token)) {
    recordLoginFail(ip)
    return NextResponse.json(fail("口令错误"), { status: 401 })
  }
  clearLoginFails(ip)

  const res = NextResponse.json(ok({ auth: true }))
  res.cookies.set("admin_token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14, // 14 天
  })
  return res
}

export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json(ok({ auth: false }))
  res.cookies.set("admin_token", "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
