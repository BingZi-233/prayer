import { describe, it, expect, beforeEach, vi, type Mock } from "vitest"
import {
  parseGroupMembers,
  membersHaveRoles,
  toAdminMemberShape,
  loadGroupMembers,
  resetMembersInflight,
  type FetchMembers,
} from "@/lib/onebot/members-fetch"
import { NameCache, resetNameCache } from "@/lib/name-cache"
import { collectAdmins } from "@/lib/onebot/admins"

describe("parseGroupMembers", () => {
  it("解析 user_id/card/nickname/role,名字优先 card", () => {
    const rows = parseGroupMembers([
      { user_id: 1, card: "名片", nickname: "昵称", role: "owner" },
      { user_id: 2, nickname: "仅昵称", role: "admin" },
      { user_id: 3, role: "member" },
      { user_id: 0, role: "admin" },
    ])
    expect(rows).toEqual([
      { userId: 1, name: "名片", role: "owner" },
      { userId: 2, name: "仅昵称", role: "admin" },
      { userId: 3, name: "3", role: "member" },
    ])
  })
})

describe("membersHaveRoles", () => {
  it("空列表视为有 role(空群合法命中)", () => {
    expect(membersHaveRoles([])).toBe(true)
  })
  it("任一成员带 role 即 true", () => {
    expect(membersHaveRoles([{ userId: 1, name: "A" }])).toBe(false)
    expect(membersHaveRoles([{ userId: 1, name: "A", role: "admin" }])).toBe(
      true
    )
  })
})

describe("loadGroupMembers", () => {
  let cache: NameCache
  let fetchFn: Mock<FetchMembers>

  beforeEach(() => {
    resetMembersInflight()
    cache = resetNameCache(new NameCache())
    fetchFn = vi.fn<FetchMembers>(async () => [
      { user_id: 10, nickname: "甲", role: "owner" },
      { user_id: 11, nickname: "乙", role: "admin" },
      { user_id: 12, nickname: "丙", role: "member" },
    ])
  })

  it("冷 miss 打 OneBot 并写缓存;二次命中不打", async () => {
    const a = await loadGroupMembers(100, { cache, fetchFn })
    expect(a?.map((r) => r.userId)).toEqual([10, 11, 12])
    expect(a?.[0]?.role).toBe("owner")
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const b = await loadGroupMembers(100, { cache, fetchFn })
    expect(b?.map((r) => r.userId)).toEqual([10, 11, 12])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("旧缓存无 role 时 requireRoles 触发刷新", async () => {
    cache.setMembersList(100, [
      { userId: 10, name: "甲" },
      { userId: 11, name: "乙" },
    ])
    // 不要求 role → 命中旧缓存
    const namesOnly = await loadGroupMembers(100, { cache, fetchFn })
    expect(namesOnly?.[0]?.role).toBeUndefined()
    expect(fetchFn).not.toHaveBeenCalled()

    // admins 路径要求 role → 刷新
    const withRoles = await loadGroupMembers(100, {
      cache,
      fetchFn,
      requireRoles: true,
    })
    expect(withRoles?.[0]?.role).toBe("owner")
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // 刷新后再 requireRoles 仍命中
    await loadGroupMembers(100, { cache, fetchFn, requireRoles: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("并发冷 miss 共用一次 fetch", async () => {
    let resolveFetch!: (v: unknown[]) => void
    fetchFn.mockImplementation(
      () =>
        new Promise<unknown[]>((res) => {
          resolveFetch = res
        })
    )

    const p1 = loadGroupMembers(7, { cache, fetchFn })
    const p2 = loadGroupMembers(7, { cache, fetchFn })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    resolveFetch([{ user_id: 1, nickname: "A", role: "admin" }])
    const [a, b] = await Promise.all([p1, p2])
    expect(a).toEqual(b)
    expect(a?.[0]).toEqual({ userId: 1, name: "A", role: "admin" })
  })

  it("fetch 失败 → null 且不写缓存", async () => {
    fetchFn.mockResolvedValue(undefined)
    expect(await loadGroupMembers(1, { cache, fetchFn })).toBeNull()
    expect(cache.getMembersList(1)).toBeUndefined()
  })

  it("toAdminMemberShape + collectAdmins 可筛出管理", async () => {
    const rows = await loadGroupMembers(100, { cache, fetchFn })
    const admins = collectAdmins(
      [{ groupId: 100, members: toAdminMemberShape(rows!) }],
      { excludeUserIds: [10] }
    )
    // owner 10 被 exclude,只剩 admin 11
    expect(admins.map((a) => a.userId)).toEqual([11])
    expect(admins[0]?.role).toBe("admin")
  })
})
