import { describe, it, expect, beforeEach } from "vitest"
import {
  NameCache,
  NAME_CACHE_TTL_MS,
  resetNameCache,
  getNameCache,
} from "@/lib/core/chat/name-cache"
import { openDb } from "@/lib/core/db/index"
import { createSqliteNameCachePersistence } from "@/lib/core/chat/name-cache-store"

describe("NameCache", () => {
  let now = 1_000_000
  let cache: NameCache

  beforeEach(() => {
    now = 1_000_000
    cache = resetNameCache(new NameCache(() => now))
  })

  it("群名与用户名分表:同数字 id 互不覆盖", () => {
    cache.setGroupsList([{ groupId: 10001, groupName: "客服大群" }])
    cache.setMembersList(999, [{ userId: 10001, name: "小明" }])

    expect(cache.getGroupName(10001)).toBe("客服大群")
    expect(cache.getUserName(10001)).toBe("小明")
  })

  it("setGroupName 支持 TG 负 chatId,listCachedGroupNames 可见", () => {
    cache.setGroupName(-1002816910724, "Packycode Chat")
    expect(cache.getGroupName(-1002816910724)).toBe("Packycode Chat")
    expect(cache.listCachedGroupNames()).toEqual([
      { groupId: -1002816910724, groupName: "Packycode Chat" },
    ])
  })

  it("setChatName / getChatName / listCachedChatNames 以 channel:chatId 为键", () => {
    cache.setChatName("tg", "-1002816910724", "Packycode Chat")
    cache.setChatName("qq", "10001", "客服大群")
    expect(cache.getChatName("tg", "-1002816910724")).toBe("Packycode Chat")
    expect(cache.getChatName("qq", "10001")).toBe("客服大群")
    // 错通道不命中
    expect(cache.getChatName("qq", "-1002816910724")).toBeUndefined()
    expect(cache.listCachedChatNames()).toEqual(
      expect.arrayContaining([
        {
          channel: "tg",
          chatId: "-1002816910724",
          chatName: "Packycode Chat",
        },
        { channel: "qq", chatId: "10001", chatName: "客服大群" },
      ])
    )
  })

  it("群列表命中后返回拷贝,写回不影响缓存", () => {
    cache.setGroupsList([
      { groupId: 1, groupName: "甲" },
      { groupId: 2, groupName: "乙" },
    ])
    const a = cache.getGroupsList()!
    a[0]!.groupName = "被改"
    expect(cache.getGroupsList()![0]!.groupName).toBe("甲")
  })

  it("TTL 内 getGroupsList 命中;过期后 miss", () => {
    cache.setGroupsList([{ groupId: 1, groupName: "甲" }])
    expect(cache.getGroupsList()?.map((g) => g.groupId)).toEqual([1])

    now += NAME_CACHE_TTL_MS - 1
    expect(cache.getGroupsList()).toBeDefined()

    now += 2
    expect(cache.getGroupsList()).toBeUndefined()
    expect(cache.getGroupName(1)).toBeUndefined()
  })

  it("成员列表按群缓存;TTL 过期 miss", () => {
    cache.setMembersList(10, [
      { userId: 1, name: "A" },
      { userId: 2, name: "B" },
    ])
    expect(cache.getMembersList(10)?.map((m) => m.userId)).toEqual([1, 2])
    expect(cache.getMembersList(11)).toBeUndefined()
    expect(cache.getUserName(1)).toBe("A")

    now += NAME_CACHE_TTL_MS + 1
    expect(cache.getMembersList(10)).toBeUndefined()
    expect(cache.getUserName(1)).toBeUndefined()
  })

  it("clear 清空所有分表与快照", () => {
    cache.setGroupsList([{ groupId: 1, groupName: "甲" }])
    cache.setMembersList(1, [{ userId: 2, name: "乙" }])
    cache.clear()
    expect(cache.getGroupsList()).toBeUndefined()
    expect(cache.getMembersList(1)).toBeUndefined()
    expect(cache.getGroupName(1)).toBeUndefined()
    expect(cache.getUserName(2)).toBeUndefined()
    expect(cache.size()).toEqual({
      groups: 0,
      users: 0,
      memberSnaps: 0,
      hasGroupsSnap: false,
    })
  })

  it("getNameCache 返回进程单例", () => {
    const a = getNameCache()
    const b = getNameCache()
    expect(a).toBe(b)
    expect(a).toBe(cache)
  })
})

describe("NameCache SQLite 持久化", () => {
  it("写入后新实例 attach 可灌回,群/用户分表不串", () => {
    const db = openDb(":memory:", 3)
    const store = createSqliteNameCachePersistence(db)

    let now = 5_000_000
    const a = new NameCache(() => now)
    a.attachPersistence(store)
    a.setGroupsList([{ groupId: 42, groupName: "群甲" }])
    a.setMembersList(42, [{ userId: 42, name: "用户甲" }])

    // 模拟重启:新内存实例 + 同一 DB
    const b = new NameCache(() => now)
    b.attachPersistence(store)
    expect(b.getGroupsList()?.[0]).toEqual({ groupId: 42, groupName: "群甲" })
    expect(b.getGroupName(42)).toBe("群甲")
    expect(b.getUserName(42)).toBe("用户甲")
    expect(b.getMembersList(42)?.[0]?.name).toBe("用户甲")

    // 过期后灌回为空
    now += NAME_CACHE_TTL_MS + 1
    const c = new NameCache(() => now)
    c.attachPersistence(store)
    expect(c.getGroupsList()).toBeUndefined()
    expect(c.getGroupName(42)).toBeUndefined()
    expect(c.getUserName(42)).toBeUndefined()
    expect(c.getMembersList(42)).toBeUndefined()
  })

  it("clear 同步清盘", () => {
    const db = openDb(":memory:", 3)
    const store = createSqliteNameCachePersistence(db)
    const a = new NameCache()
    a.attachPersistence(store)
    a.setGroupsList([{ groupId: 1, groupName: "甲" }])
    a.clear()

    const b = new NameCache()
    b.attachPersistence(store)
    expect(b.getGroupsList()).toBeUndefined()
  })

  it("setGroupName 负 chatId 持久化灌回", () => {
    const db = openDb(":memory:", 3)
    const store = createSqliteNameCachePersistence(db)
    const a = new NameCache()
    a.attachPersistence(store)
    a.setGroupName(-1002816910724, "Packycode Chat")

    const b = new NameCache()
    b.attachPersistence(store)
    expect(b.getGroupName(-1002816910724)).toBe("Packycode Chat")
  })

  it("损坏 JSON 不当作空列表命中", () => {
    const db = openDb(":memory:", 3)
    db.prepare(
      "INSERT INTO name_cache_groups_list (id, rows_json, exp) VALUES (1, ?, ?)"
    ).run("not-json{{{", Date.now() + 86_400_000)
    db.prepare(
      "INSERT INTO name_cache_members (group_id, rows_json, exp) VALUES (?, ?, ?)"
    ).run(9, '{"bad":true}', Date.now() + 86_400_000)

    const store = createSqliteNameCachePersistence(db)
    const cache = new NameCache()
    cache.attachPersistence(store)
    expect(cache.getGroupsList()).toBeUndefined()
    expect(cache.getMembersList(9)).toBeUndefined()
  })

  it("合法空数组仍算命中", () => {
    const db = openDb(":memory:", 3)
    const store = createSqliteNameCachePersistence(db)
    const a = new NameCache()
    a.attachPersistence(store)
    a.setGroupsList([])
    a.setMembersList(1, [])

    const b = new NameCache()
    b.attachPersistence(store)
    expect(b.getGroupsList()).toEqual([])
    expect(b.getMembersList(1)).toEqual([])
  })
})
