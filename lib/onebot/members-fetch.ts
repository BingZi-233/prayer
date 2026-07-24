// 群成员列表拉取 + name-cache 复用。
// members / admins 共用:24h TTL 内不再打 OneBot get_group_member_list;
// 并发冷 miss 按群 inflight 合并。新写入的快照含 role,供「额外监听 AT」筛 owner/admin。

import { getNameCache, type UserNameRow } from "@/lib/name-cache"
import { getRuntime } from "@/lib/runtime"

// 群友名最长 9 字,超出截断加省略号。Array.from 按码点切,避免截断 emoji / CJK。
function clamp(name: string): string {
  const chars = Array.from(name)
  return chars.length > 9 ? chars.slice(0, 9).join("") + "…" : name
}

/** 将 OneBot get_group_member_list 原始行解析为缓存行(含 role) */
export function parseGroupMembers(raw: unknown[]): UserNameRow[] {
  return raw
    .map((m) => {
      const o = m as {
        user_id?: unknown
        card?: unknown
        nickname?: unknown
        role?: unknown
      }
      const userId = Number(o.user_id)
      const card = typeof o.card === "string" ? o.card.trim() : ""
      const nickname = typeof o.nickname === "string" ? o.nickname.trim() : ""
      const row: UserNameRow = {
        userId,
        name: clamp(card || nickname || String(userId)),
      }
      if (typeof o.role === "string" && o.role) row.role = o.role
      return row
    })
    .filter((m) => Number.isFinite(m.userId) && m.userId > 0)
}

/** 缓存行是否带 role(旧快照无 role → admins 视为 miss,触发一次刷新后写回) */
export function membersHaveRoles(rows: UserNameRow[]): boolean {
  if (rows.length === 0) return true
  return rows.some((r) => typeof r.role === "string" && r.role.length > 0)
}

/** 缓存行 → collectAdmins 期望的 OneBot 形态 */
export function toAdminMemberShape(rows: UserNameRow[]): unknown[] {
  return rows.map((r) => ({
    user_id: r.userId,
    nickname: r.name,
    role: r.role,
  }))
}

// 按群并发冷 miss 共用一次 OneBot 拉取
const membersInflight = new Map<number, Promise<UserNameRow[] | null>>()

export type FetchMembers = (groupId: number) => Promise<unknown[] | undefined>

export type LoadGroupMembersOpts = {
  /** 强制绕过缓存 */
  refresh?: boolean
  /** 为 true 时:缓存命中但无 role 字段 → 视为 miss(admins 需要 role) */
  requireRoles?: boolean
  /** 测试注入 */
  fetchFn?: FetchMembers
  cache?: ReturnType<typeof getNameCache>
}

/**
 * 拉某群成员列表(含名片/昵称/role)。
 * 命中 name-cache 且满足 requireRoles 时直接返回;否则打 OneBot 并写回缓存。
 */
export async function loadGroupMembers(
  groupId: number,
  opts: LoadGroupMembersOpts = {}
): Promise<UserNameRow[] | null> {
  const cache = opts.cache ?? getNameCache()

  if (!opts.refresh) {
    const hit = cache.getMembersList(groupId)
    if (hit && (!opts.requireRoles || membersHaveRoles(hit))) {
      return hit
    }
  }

  const pending = membersInflight.get(groupId)
  if (pending) return pending

  const fetchFn =
    opts.fetchFn ?? ((gid: number) => getRuntime().getGroupMembers(gid))

  const p = (async () => {
    const raw = await fetchFn(groupId)
    if (!Array.isArray(raw)) return null
    const list = parseGroupMembers(raw)
    cache.setMembersList(groupId, list)
    return list
  })().finally(() => {
    membersInflight.delete(groupId)
  })

  membersInflight.set(groupId, p)
  return p
}

/** 仅测试:清空 inflight(避免跨用例串扰) */
export function resetMembersInflight(): void {
  membersInflight.clear()
}
