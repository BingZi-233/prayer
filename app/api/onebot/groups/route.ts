import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import { ok, fail } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  const raw = await getRuntime().getGroups();
  if (!Array.isArray(raw)) {
    return NextResponse.json(fail("bot 未连接或无法获取群列表"), { status: 503 });
  }
  const list = raw
    .map((g) => {
      const o = g as { group_id?: unknown; group_name?: unknown };
      const groupId = Number(o.group_id);
      return { groupId, groupName: String(o.group_name ?? groupId) };
    })
    .filter((g) => Number.isFinite(g.groupId) && g.groupId > 0);
  return NextResponse.json(ok(list));
}
