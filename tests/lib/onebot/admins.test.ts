import { describe, it, expect } from "vitest"
import { collectAdmins } from "@/lib/onebot/admins"

describe("collectAdmins", () => {
  it("只保留 owner/admin,member 丢弃", () => {
    const list = collectAdmins([
      {
        groupId: 1,
        members: [
          { user_id: 10, nickname: "甲", role: "owner" },
          { user_id: 11, nickname: "乙", role: "admin" },
          { user_id: 12, nickname: "丙", role: "member" },
        ],
      },
    ])
    expect(list.map((a) => a.userId)).toEqual([10, 11])
    expect(list[0].role).toBe("owner")
    expect(list[1].role).toBe("admin")
  })

  it("跨群同 QQ 去重,合并 groupIds,角色取最高", () => {
    const list = collectAdmins([
      {
        groupId: 1,
        members: [{ user_id: 10, card: "管理甲", role: "admin" }],
      },
      {
        groupId: 2,
        members: [{ user_id: 10, nickname: "甲", role: "owner" }],
      },
    ])
    expect(list).toHaveLength(1)
    expect(list[0].userId).toBe(10)
    expect(list[0].role).toBe("owner")
    expect(list[0].groupIds).toEqual([1, 2])
    expect(list[0].name).toBe("管理甲") // 保留已有非 uid 名
  })

  it("excludeUserIds 排除 bot 自身", () => {
    const list = collectAdmins(
      [
        {
          groupId: 1,
          members: [
            { user_id: 555, nickname: "bot", role: "admin" },
            { user_id: 10, nickname: "甲", role: "admin" },
          ],
        },
      ],
      { excludeUserIds: [555] }
    )
    expect(list.map((a) => a.userId)).toEqual([10])
  })

  it("名字优先 card,否则 nickname,否则 uid 字符串", () => {
    const list = collectAdmins([
      {
        groupId: 1,
        members: [
          { user_id: 1, card: " 名片 ", nickname: "昵称", role: "admin" },
          { user_id: 2, nickname: "仅昵称", role: "admin" },
          { user_id: 3, role: "admin" },
        ],
      },
    ])
    expect(list.find((a) => a.userId === 1)?.name).toBe("名片")
    expect(list.find((a) => a.userId === 2)?.name).toBe("仅昵称")
    expect(list.find((a) => a.userId === 3)?.name).toBe("3")
  })

  it("非法 / 空成员 → 空列表", () => {
    expect(collectAdmins([])).toEqual([])
    expect(
      collectAdmins([{ groupId: 1, members: [{ user_id: 0, role: "admin" }] }])
    ).toEqual([])
    expect(
      collectAdmins([{ groupId: 1, members: "bad" as unknown as unknown[] }])
    ).toEqual([])
  })
})
