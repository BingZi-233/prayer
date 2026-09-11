import { describe, it, expect } from "vitest"
import {
  errorMessage,
  groupIdFromSession,
  chatRefFromSession,
} from "@/lib/core/log-context"

describe("errorMessage / chatRefFromSession", () => {
  it("errorMessage", () => {
    expect(errorMessage(new Error("x"))).toBe("x")
    expect(errorMessage("y")).toBe("y")
    expect(errorMessage({ a: 1 })).toBe('{"a":1}')
  })

  it("chatRefFromSession 规范键与历史两段键", () => {
    expect(chatRefFromSession("qq:42:9")).toEqual({
      channel: "qq",
      chatId: "42",
    })
    expect(chatRefFromSession("tg:-1001:7")).toEqual({
      channel: "tg",
      chatId: "-1001",
    })
    expect(chatRefFromSession("42:9")).toEqual({
      channel: "qq",
      chatId: "42",
    })
    expect(chatRefFromSession(undefined)).toBeUndefined()
    expect(chatRefFromSession("abc")).toBeUndefined()
  })

  it("groupIdFromSession 仍兼容 QQ 数字", () => {
    expect(groupIdFromSession("42:9")).toBe(42)
    expect(groupIdFromSession("tg:-1001:7")).toBeUndefined()
    expect(groupIdFromSession(undefined)).toBeUndefined()
  })
})
