import { describe, it, expect, beforeEach } from "vitest"
import {
  AdminsCache,
  mapChatMembersToAdmins,
  type AdminEntry,
} from "@/lib/channels/tg/admins-cache"
import {
  isTgChatBypassEnabled,
  getTgBypassBlockReason,
  listTgBypassBlocks,
  _resetTgBypassStateForTests,
} from "@/lib/channels/tg/bypass-state"

describe("mapChatMembersToAdmins", () => {
  it("creator→owner, administrator→admin, 其余丢弃", () => {
    const list = mapChatMembersToAdmins([
      { user: { id: 1 }, status: "creator" },
      { user: { id: 2 }, status: "administrator" },
      { user: { id: 3 }, status: "member" },
      { user: { id: 4 }, status: "restricted" },
      { status: "administrator" }, // 无 user
    ])
    expect(list).toEqual([
      { userId: "1", role: "owner" },
      { userId: "2", role: "admin" },
    ])
  })
})

describe("AdminsCache", () => {
  let now = 1_000_000
  let fetches = 0
  let failNext = false
  let admins: AdminEntry[] = [
    { userId: "10", role: "owner" },
    { userId: "20", role: "admin" },
  ]

  beforeEach(() => {
    now = 1_000_000
    fetches = 0
    failNext = false
    admins = [
      { userId: "10", role: "owner" },
      { userId: "20", role: "admin" },
    ]
    _resetTgBypassStateForTests()
  })

  function make(ttlMs = 15 * 60_000) {
    return new AdminsCache({
      getChatAdministrators: async () => {
        fetches++
        if (failNext) throw new Error("api down")
        return admins
      },
      now: () => now,
      ttlMs,
      privacyMinObservations: 20,
      privacyNonMentionShareMin: 0.05,
    })
  }

  it("未知 chat 首次 lookup 强制拉取", async () => {
    const c = make()
    expect(await c.getRole("-1001", "10")).toBe("owner")
    expect(await c.getRole("-1001", "20")).toBe("admin")
    expect(await c.getRole("-1001", "99")).toBe("member")
    expect(fetches).toBe(1)
  })

  it("TTL 内不重复拉取；过期后刷新", async () => {
    const c = make(1000)
    await c.getRole("-1", "10")
    expect(fetches).toBe(1)
    now += 500
    await c.getRole("-1", "10")
    expect(fetches).toBe(1)
    now += 600
    await c.getRole("-1", "10")
    expect(fetches).toBe(2)
  })

  it("拉取失败 → member 回退 + 封锁旁路", async () => {
    failNext = true
    const c = make()
    expect(await c.getRole("-100", "10")).toBe("member")
    expect(c.isBypassBlocked("-100")).toBe(true)
    expect(c.bypassBlockReason("-100")).toBe("admins-failed")
    expect(isTgChatBypassEnabled("-100")).toBe(false)
    expect(getTgBypassBlockReason("-100")).toBe("admins-failed")
  })

  it("失败后 TTL 内不重试；过期可恢复", async () => {
    failNext = true
    const c = make(1000)
    await c.getRole("-2", "1")
    expect(fetches).toBe(1)
    now += 500
    await c.getRole("-2", "1")
    expect(fetches).toBe(1)
    failNext = false
    now += 600
    expect(await c.getRole("-2", "10")).toBe("owner")
    expect(c.isBypassBlocked("-2")).toBe(false)
    expect(isTgChatBypassEnabled("-2")).toBe(true)
  })

  it("Privacy 启发式：≥20 条几乎全 @ 则封锁", () => {
    const c = make()
    for (let i = 0; i < 20; i++) {
      c.observeMessage("-p", true)
    }
    expect(c.isBypassBlocked("-p")).toBe(true)
    expect(c.bypassBlockReason("-p")).toBe("privacy-mode?")
    expect(isTgChatBypassEnabled("-p")).toBe(false)
  })

  it("非 bot 可见消息解除 privacy 封锁", () => {
    const c = make()
    for (let i = 0; i < 20; i++) c.observeMessage("-p", true)
    expect(c.isBypassBlocked("-p")).toBe(true)
    c.observeMessage("-p", false)
    expect(c.isBypassBlocked("-p")).toBe(false)
    expect(isTgChatBypassEnabled("-p")).toBe(true)
  })

  it("解封后重置 streak：紧随 bot 可见消息不立刻再封", () => {
    const c = make()
    for (let i = 0; i < 20; i++) c.observeMessage("-p", true)
    expect(c.isBypassBlocked("-p")).toBe(true)
    c.observeMessage("-p", false)
    expect(c.isBypassBlocked("-p")).toBe(false)
    // 解封后仅 1 条 bot 可见不应 thrash 再封
    c.observeMessage("-p", true)
    expect(c.isBypassBlocked("-p")).toBe(false)
    expect(isTgChatBypassEnabled("-p")).toBe(true)
    // 再连续 20 条才重新封锁
    for (let i = 0; i < 19; i++) c.observeMessage("-p", true)
    expect(c.isBypassBlocked("-p")).toBe(true)
  })

  it("admins 失败覆盖 privacy 后恢复成功仍重挂 privacy-mode?", async () => {
    const c = make(1000)
    for (let i = 0; i < 20; i++) c.observeMessage("-mix", true)
    expect(getTgBypassBlockReason("-mix")).toBe("privacy-mode?")
    failNext = true
    await c.getRole("-mix", "1")
    expect(getTgBypassBlockReason("-mix")).toBe("admins-failed")
    failNext = false
    now += 2000
    await c.getRole("-mix", "10")
    // admins 恢复后，streak 仍 ≥ 阈值 → 重新 privacy 封锁
    expect(getTgBypassBlockReason("-mix")).toBe("privacy-mode?")
    expect(isTgChatBypassEnabled("-mix")).toBe(false)
  })

  it("listBypassBlocks 汇总", async () => {
    failNext = true
    const c = make()
    await c.getRole("-a", "1")
    for (let i = 0; i < 20; i++) c.observeMessage("-b", true)
    const list = c.listBypassBlocks()
    expect(list).toEqual(
      expect.arrayContaining([
        { chatId: "-a", reason: "admins-failed" },
        { chatId: "-b", reason: "privacy-mode?" },
      ])
    )
    expect(listTgBypassBlocks().length).toBeGreaterThanOrEqual(2)
  })
})
