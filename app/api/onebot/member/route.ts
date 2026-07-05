import { NextRequest, NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import { ok, fail } from "@/lib/api";

// 查群成员群名片/昵称:?group=<gid>&user=<uid> → { name }
// name = 群名片(card) || 昵称(nickname) || 裸 uid。bot 未连接/查不到 → 503,前端回退 uid。
export async function GET(req: NextRequest): Promise<NextResponse> {
  const group = Number(req.nextUrl.searchParams.get("group"));
  const user = Number(req.nextUrl.searchParams.get("user"));
  if (!Number.isFinite(group) || !Number.isFinite(user) || group <= 0 || user <= 0) {
    return NextResponse.json(fail("group / user 参数非法"), { status: 400 });
  }
  try {
    const info = await getRuntime().getMemberInfo(group, user);
    if (!info) {
      return NextResponse.json(fail("bot 未连接或查不到成员"), { status: 503 });
    }
    const name = (info.card && info.card.trim()) || (info.nickname && info.nickname.trim()) || String(user);
    return NextResponse.json(ok({ name }));
  } catch (err) {
    // getMemberInfo 缺失/onebot 异常 → 降级,不 500(前端回退 uid)
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 503 });
  }
}
