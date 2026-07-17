// 进程级名称缓存:群名与 QQ 用户名分表存放(数字 id 会撞车,绝不能混 key)。
// TTL 24h;命中则 API 层不再打 OneBot。
// 默认挂 SQLite 持久化(agent.db),进程重启后未过期条目继续命中。

import {
  createSqliteNameCachePersistence,
  type GroupNameRow,
  type NameCachePersistence,
  type UserNameRow,
} from "@/lib/name-cache-store"

export type { GroupNameRow, UserNameRow, NameCachePersistence }
export const NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000

type ExpEntry = { name: string; exp: number }
type MembersSnap = { rows: UserNameRow[]; exp: number }
type GroupsSnap = { rows: GroupNameRow[]; exp: number }

export class NameCache {
  /** 群 id → 群名 */
  private groups = new Map<number, ExpEntry>()
  /** QQ 号 → 显示名(名片/昵称) */
  private users = new Map<number, ExpEntry>()
  /** 群列表整包快照(含顺序);过期后需重新拉 OneBot */
  private groupsSnap: GroupsSnap | null = null
  /** 某群成员列表整包快照;过期后需重新拉 OneBot */
  private membersSnap = new Map<number, MembersSnap>()

  private now: () => number
  private persist?: NameCachePersistence
  private hydrated = false

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  private alive(exp: number): boolean {
    return this.now() < exp
  }

  /** 挂载持久化层并立即从盘灌回(幂等:只 hydrate 一次) */
  attachPersistence(p: NameCachePersistence): void {
    this.persist = p
    if (this.hydrated) return
    this.hydrated = true
    try {
      const snap = p.load(this.now())
      if (snap.groupsSnap && this.alive(snap.groupsSnap.exp)) {
        this.groupsSnap = {
          rows: snap.groupsSnap.rows.map((r) => ({ ...r })),
          exp: snap.groupsSnap.exp,
        }
      }
      for (const g of snap.groups) {
        if (this.alive(g.exp))
          this.groups.set(g.groupId, { name: g.name, exp: g.exp })
      }
      for (const u of snap.users) {
        if (this.alive(u.exp))
          this.users.set(u.userId, { name: u.name, exp: u.exp })
      }
      for (const m of snap.membersSnaps) {
        if (!this.alive(m.exp)) continue
        this.membersSnap.set(m.groupId, {
          rows: m.rows.map((r) => ({ ...r })),
          exp: m.exp,
        })
      }
    } catch {
      /* 读盘失败不阻断:退化为纯内存 */
    }
  }

  getGroupName(groupId: number): string | undefined {
    const e = this.groups.get(groupId)
    if (!e) return undefined
    if (!this.alive(e.exp)) {
      this.groups.delete(groupId)
      return undefined
    }
    return e.name
  }

  /**
   * 写入/刷新单个群名(不改动 get_group_list 整包快照)。
   * TG 用负 chatId(如 -100…);QQ 用正群号。
   */
  setGroupName(groupId: number, name: string, ttlMs = NAME_CACHE_TTL_MS): void {
    if (!Number.isFinite(groupId) || !name) return
    const t = this.now()
    const exp = t + ttlMs
    this.groups.set(groupId, { name, exp })
    try {
      this.persist?.saveGroup(groupId, name, exp, t)
    } catch {
      /* 写盘失败不阻断主链路 */
    }
  }

  /** 当前仍有效的单群名(含 TG 负 id),供 /api/chats/names 合并 */
  listCachedGroupNames(): GroupNameRow[] {
    const out: GroupNameRow[] = []
    for (const [groupId, e] of this.groups) {
      if (!this.alive(e.exp)) {
        this.groups.delete(groupId)
        continue
      }
      out.push({ groupId, groupName: e.name })
    }
    return out
  }

  getUserName(userId: number): string | undefined {
    const e = this.users.get(userId)
    if (!e) return undefined
    if (!this.alive(e.exp)) {
      this.users.delete(userId)
      return undefined
    }
    return e.name
  }

  /** 群列表整包命中 → 不再请求 OneBot get_group_list */
  getGroupsList(): GroupNameRow[] | undefined {
    const snap = this.groupsSnap
    if (!snap) return undefined
    if (!this.alive(snap.exp)) {
      this.groupsSnap = null
      return undefined
    }
    return snap.rows.map((r) => ({ ...r }))
  }

  setGroupsList(rows: GroupNameRow[], ttlMs = NAME_CACHE_TTL_MS): void {
    const t = this.now()
    const exp = t + ttlMs
    this.groupsSnap = { rows: rows.map((r) => ({ ...r })), exp }
    for (const r of rows) {
      this.groups.set(r.groupId, { name: r.groupName, exp })
    }
    try {
      this.persist?.saveGroupsList(rows, exp, t)
    } catch {
      /* 写盘失败不阻断主链路 */
    }
  }

  /** 某群成员整包命中 → 不再请求 OneBot get_group_member_list */
  getMembersList(groupId: number): UserNameRow[] | undefined {
    const snap = this.membersSnap.get(groupId)
    if (!snap) return undefined
    if (!this.alive(snap.exp)) {
      this.membersSnap.delete(groupId)
      return undefined
    }
    return snap.rows.map((r) => ({ ...r }))
  }

  setMembersList(
    groupId: number,
    rows: UserNameRow[],
    ttlMs = NAME_CACHE_TTL_MS
  ): void {
    const t = this.now()
    const exp = t + ttlMs
    this.membersSnap.set(groupId, { rows: rows.map((r) => ({ ...r })), exp })
    for (const r of rows) {
      this.users.set(r.userId, { name: r.name, exp })
    }
    try {
      this.persist?.saveMembersList(groupId, rows, exp, t)
    } catch {
      /* 写盘失败不阻断主链路 */
    }
  }

  /** 测试 / 运维:清空全部(含持久化) */
  clear(): void {
    this.groups.clear()
    this.users.clear()
    this.groupsSnap = null
    this.membersSnap.clear()
    try {
      this.persist?.clear()
    } catch {
      /* ignore */
    }
  }

  /** 测试用:条目数快照 */
  size(): {
    groups: number
    users: number
    memberSnaps: number
    hasGroupsSnap: boolean
  } {
    return {
      groups: this.groups.size,
      users: this.users.size,
      memberSnaps: this.membersSnap.size,
      hasGroupsSnap: this.groupsSnap != null && this.alive(this.groupsSnap.exp),
    }
  }
}

const g = globalThis as unknown as { __nameCache?: NameCache }

function defaultDbPath(): string {
  // 与 runtime 一致:优先 env(启动后会写成绝对路径),否则相对路径 resolve 成绝对
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require("node:path") as typeof import("node:path")
  return resolve(
    /* turbopackIgnore: true */ process.env.DB_PATH ?? "./data/agent.db"
  )
}

/** 进程单例;首次创建时挂 SQLite 持久化并灌回未过期条目 */
export function getNameCache(): NameCache {
  // next dev HMR 后旧单例缺新方法 → 丢弃重建
  const existing = g.__nameCache as NameCache | undefined
  if (
    existing &&
    (typeof existing.listCachedGroupNames !== "function" ||
      typeof existing.setGroupName !== "function")
  ) {
    g.__nameCache = undefined
  }
  if (g.__nameCache) return g.__nameCache
  const cache = new NameCache()
  try {
    // 延迟 require,避免纯内存单测强依赖 native 初始化顺序
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sharedDb } =
      require("@/lib/db/shared") as typeof import("@/lib/db/shared")
    cache.attachPersistence(
      createSqliteNameCachePersistence(sharedDb(defaultDbPath()))
    )
  } catch {
    /* DB 不可用时仍提供内存缓存 */
  }
  g.__nameCache = cache
  return cache
}

/** 仅测试:替换/重置单例(不自动挂持久化,可自行 attach) */
export function resetNameCache(cache?: NameCache): NameCache {
  g.__nameCache = cache ?? new NameCache()
  return g.__nameCache
}
