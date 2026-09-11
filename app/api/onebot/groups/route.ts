import { NextResponse } from "next/server"
import { getRuntime } from "@/lib/runtime"
import { ok, fail } from "@/lib/core/api"
import { getNameCache, type GroupNameRow } from "@/lib/core/chat/name-cache"

function parseGroups(raw: unknown[]): GroupNameRow[] {
  return raw
    .map((g) => {
      const o = g as { group_id?: unknown; group_name?: unknown }
      const groupId = Number(o.group_id)
      return { groupId, groupName: String(o.group_name ?? groupId) }
    })
    .filter((g) => Number.isFinite(g.groupId) && g.groupId > 0)
}

// 并发冷 miss 共用一次 OneBot 拉取
let groupsInflight: Promise<GroupNameRow[] | null> | null = null

async function fetchGroupsFresh(): Promise<GroupNameRow[] | null> {
  if (groupsInflight) return groupsInflight
  groupsInflight = (async () => {
    const raw = await getRuntime().getGroups()
    if (!Array.isArray(raw)) return null
    const list = parseGroups(raw)
    getNameCache().setGroupsList(list)
    return list
  })().finally(() => {
    groupsInflight = null
  })
  return groupsInflight
}

export async function GET(): Promise<NextResponse> {
  const cache = getNameCache()
  const hit = cache.getGroupsList()
  if (hit) {
    return NextResponse.json(ok(hit))
  }

  const list = await fetchGroupsFresh()
  if (!list) {
    return NextResponse.json(fail("bot 未连接或无法获取群列表"), {
      status: 503,
    })
  }
  return NextResponse.json(ok(list))
}
