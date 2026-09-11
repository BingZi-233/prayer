"use client"

import { useEffect, useState } from "react"
import {
  legacySessionKeyToCanonical,
  parseSessionKey,
} from "@/lib/core/chat/ids"

/** 与服务端 name-cache 一致:24h */
const CLIENT_NAME_TTL_MS = 24 * 60 * 60 * 1000

// ── 浏览器端模块级缓存:跨页切换不重复打 API ──
// 群列表 / 成员列表分存;成员按群整包(名片随群),不与群 id 混 key。

type ExpMap = { data: Record<number, string>; exp: number }
type MemberSnap = { data: Record<string, string>; exp: number } // key = "gid:uid" 或 sessionKey

let groupsCache: ExpMap | null = null
let groupsInflight: Promise<Record<number, string>> | null = null

const membersByGroup = new Map<number, MemberSnap>()
const membersInflight = new Map<number, Promise<Record<string, string>>>()

function alive(exp: number): boolean {
  return Date.now() < exp
}

async function loadGroups(): Promise<Record<number, string>> {
  if (groupsCache && alive(groupsCache.exp)) return groupsCache.data
  if (groupsInflight) return groupsInflight

  // 多通道:QQ + TG 群名(负 chatId)
  groupsInflight = fetch("/api/chats/names")
    .then((x) => x.json())
    .then((r) => {
      if (!r.ok) return groupsCache?.data ?? {}
      const data = Object.fromEntries(
        (r.data as { groupId: number; groupName: string }[]).map((g) => [
          g.groupId,
          g.groupName,
        ])
      ) as Record<number, string>
      groupsCache = { data, exp: Date.now() + CLIENT_NAME_TTL_MS }
      return data
    })
    .catch(() => groupsCache?.data ?? {})
    .finally(() => {
      groupsInflight = null
    })

  return groupsInflight
}

async function loadMembers(groupId: number): Promise<Record<string, string>> {
  const hit = membersByGroup.get(groupId)
  if (hit && alive(hit.exp)) return hit.data

  // TG 负 id:暂无成员列表 API,返回空
  if (groupId < 0) {
    const empty: Record<string, string> = {}
    membersByGroup.set(groupId, {
      data: empty,
      exp: Date.now() + CLIENT_NAME_TTL_MS,
    })
    return empty
  }

  const pending = membersInflight.get(groupId)
  if (pending) return pending

  const p = fetch(`/api/onebot/members?group=${groupId}`)
    .then((x) => x.json())
    .then((r) => {
      if (!r.ok) return hit?.data ?? {}
      const data = Object.fromEntries(
        (r.data as { userId: number; name: string }[]).map((m) => [
          `${groupId}:${m.userId}`,
          m.name,
        ])
      ) as Record<string, string>
      membersByGroup.set(groupId, {
        data,
        exp: Date.now() + CLIENT_NAME_TTL_MS,
      })
      return data
    })
    .catch(() => hit?.data ?? {})
    .finally(() => {
      membersInflight.delete(groupId)
    })

  membersInflight.set(groupId, p)
  return p
}

/** 测试用:清空浏览器端名称缓存 */
export function clearClientNameCache(): void {
  groupsCache = null
  groupsInflight = null
  membersByGroup.clear()
  membersInflight.clear()
}

/** 解析会话键 → 群号(数字;TG 为负)与 userId */
export function sessionKeyParts(
  key: string
): { groupId: number; userId: string; channel: string } | null {
  const parsed = parseSessionKey(legacySessionKeyToCanonical(key))
  if (parsed) {
    const groupId = Number(parsed.chatId)
    if (!Number.isFinite(groupId)) return null
    return {
      groupId,
      userId: parsed.userId,
      channel: parsed.channel,
    }
  }
  // 极旧裸键兜底
  const m = /^(-?\d+):(\d+)$/.exec(key)
  if (!m) return null
  return { groupId: Number(m[1]), userId: m[2], channel: "qq" }
}

// 拉 /api/chats/names 建 groupId→groupName 映射;失败 → name(gid) 回退裸 id。
// 24h 内复用模块缓存,多组件挂载不重复请求。
export function useGroupNames() {
  const [names, setNames] = useState<Record<number, string>>(() =>
    groupsCache && alive(groupsCache.exp) ? groupsCache.data : {}
  )

  useEffect(() => {
    let aliveFlag = true
    void loadGroups().then((data) => {
      if (aliveFlag) setNames(data)
    })
    return () => {
      aliveFlag = false
    }
  }, [])

  const name = (gid: number) => names[gid] ?? String(gid)
  // session key "qq:gid:uid" / "tg:-100…:uid" / 旧 "gid:uid" → "群名 · uid"
  const label = (key: string) => {
    const p = sessionKeyParts(key)
    if (!p) return key
    return p.userId ? `${name(p.groupId)} · ${p.userId}` : name(p.groupId)
  }
  return { names, name, label }
}

// 解析 joined key 列表:缓存仍新鲜的成员映射(seeded)、待拉取的群(missing),
// 以及把 "gid:uid" 成员映射投影回原始 session key(含 tg: 前缀)的函数。
function resolveMembers(joined: string): {
  seeded: Record<string, string>
  missing: number[]
  applyToKeys: (memberMap: Record<string, string>) => Record<string, string>
} {
  const uniq = Array.from(new Set(joined.split(",").filter(Boolean)))
  const parts = uniq
    .map((k) => {
      const p = sessionKeyParts(k)
      return p ? { key: k, ...p } : null
    })
    .filter(
      (
        x
      ): x is {
        key: string
        groupId: number
        userId: string
        channel: string
      } => !!x
    )

  const gids = Array.from(new Set(parts.map((p) => p.groupId)))
  const seeded: Record<string, string> = {}
  const missing: number[] = []
  for (const g of gids) {
    const hit = membersByGroup.get(g)
    if (hit && alive(hit.exp)) Object.assign(seeded, hit.data)
    else missing.push(g)
  }
  const applyToKeys = (memberMap: Record<string, string>) => {
    const out: Record<string, string> = {}
    for (const p of parts) {
      const nick = memberMap[`${p.groupId}:${p.userId}`]
      if (nick) out[p.key] = nick
    }
    return out
  }
  return { seeded, missing, applyToKeys }
}

// 解析 session key 对应的群成员群名片/昵称。
// QQ:按 gid 拉 /api/onebot/members;TG 暂无 → 空串。
// bot 断连/查不到 → memberName(key) 返回 ""(调用方回退 uid)。
export function useMemberNames(keys: string[]) {
  const [map, setMap] = useState<Record<string, string>>({})
  const joined = keys.join(",")

  // 缓存命中部分渲染期同步灌入,首屏立刻有名(替代 effect 内同步 setState)
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (seededFor !== joined) {
    setSeededFor(joined)
    const { seeded, applyToKeys } = resolveMembers(joined)
    if (Object.keys(seeded).length > 0) {
      setMap((prev) => ({ ...prev, ...applyToKeys(seeded) }))
    }
  }

  useEffect(() => {
    const { missing, applyToKeys } = resolveMembers(joined)
    if (missing.length === 0) return

    let aliveFlag = true

    void Promise.all(missing.map((g) => loadMembers(g))).then((memberParts) => {
      if (!aliveFlag) return
      const merged = Object.assign({}, ...memberParts) as Record<string, string>
      setMap((prev) => ({ ...prev, ...applyToKeys(merged) }))
    })

    return () => {
      aliveFlag = false
    }
  }, [joined])

  return (key: string) => map[key] || ""
}
