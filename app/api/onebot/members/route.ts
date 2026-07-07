import { NextRequest, NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import { ok, fail } from "@/lib/api";

// 群友名最长 9 字,超出截断加省略号。Array.from 按码点切,避免截断 emoji / CJK。
function clamp(name: string): string {
  const chars = Array.from(name);
  return chars.length > 9 ? chars.slice(0, 9).join("") + "…" : name;
}

// 批量拉整群成员群名片/昵称:?group=<gid> → [{ userId, name }]
// name = 群名片(card) || 昵称(nickname) || 裸 uid,最长 9 字。一次返回整群,免前端逐成员单查。
// bot 未连接/查不到 → 503,前端回退 uid。
export async function GET(req: NextRequest): Promise<NextResponse> {
  const group = Number(req.nextUrl.searchParams.get("group"));
  if (!Number.isFinite(group) || group <= 0) {
    return NextResponse.json(fail("group 参数非法"), { status: 400 });
  }
  const raw = await getRuntime().getGroupMembers(group);
  if (!Array.isArray(raw)) {
    return NextResponse.json(fail("bot 未连接或无法获取群成员"), { status: 503 });
  }
  const list = raw
    .map((m) => {
      const o = m as { user_id?: unknown; card?: unknown; nickname?: unknown };
      const userId = Number(o.user_id);
      const card = typeof o.card === "string" ? o.card.trim() : "";
      const nickname = typeof o.nickname === "string" ? o.nickname.trim() : "";
      return { userId, name: clamp(card || nickname || String(userId)) };
    })
    .filter((m) => Number.isFinite(m.userId) && m.userId > 0);
  return NextResponse.json(ok(list));
}
