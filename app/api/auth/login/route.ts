import { NextRequest, NextResponse } from "next/server"
import { ok, fail } from "@/lib/api"

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = process.env.ADMIN_TOKEN
  if (!token) {
    return NextResponse.json(
      ok({ auth: false, message: "未启用鉴权(未设置 ADMIN_TOKEN)" })
    )
  }
  const body = await req.json().catch(() => null)
  const provided = typeof body?.token === "string" ? body.token : ""
  if (provided !== token) {
    return NextResponse.json(fail("口令错误"), { status: 401 })
  }
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
