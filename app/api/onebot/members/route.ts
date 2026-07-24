import { NextRequest, NextResponse } from "next/server"
import { ok, fail } from "@/lib/api"
import { loadGroupMembers } from "@/lib/onebot/members-fetch"

// 批量拉整群成员群名片/昵称:?group=<gid> → [{ userId, name, role? }]
// name = 群名片(card) || 昵称(nickname) || 裸 uid,最长 9 字。
// 24h 内命中 name-cache 则不再打 OneBot;与 /api/onebot/admins 共用缓存。
// bot 未连接/查不到 → 503,前端回退 uid。
export async function GET(req: NextRequest): Promise<NextResponse> {
  const group = Number(req.nextUrl.searchParams.get("group"))
  if (!Number.isFinite(group) || group <= 0) {
    return NextResponse.json(fail("group 参数非法"), { status: 400 })
  }

  const refresh = req.nextUrl.searchParams.get("refresh") === "1"
  const list = await loadGroupMembers(group, { refresh })
  if (!list) {
    return NextResponse.json(fail("bot 未连接或无法获取群成员"), {
      status: 503,
    })
  }
  return NextResponse.json(ok(list))
}
