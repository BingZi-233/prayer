import { describe, it, expect } from "vitest"
import { sessionKeyParts } from "@/lib/group-name"

describe("sessionKeyParts", () => {
  it("解析 tg 三元键含负 chatId", () => {
    expect(sessionKeyParts("tg:-1002816910724:2118120294")).toEqual({
      groupId: -1002816910724,
      userId: "2118120294",
      channel: "tg",
    })
  })

  it("解析 qq 三元键与旧两段键", () => {
    expect(sessionKeyParts("qq:187976588:1")).toEqual({
      groupId: 187976588,
      userId: "1",
      channel: "qq",
    })
    expect(sessionKeyParts("187976588:1")).toEqual({
      groupId: 187976588,
      userId: "1",
      channel: "qq",
    })
  })
})
