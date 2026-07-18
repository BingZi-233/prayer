import { describe, it, expect } from "vitest"
import {
  makeSessionKey,
  makeDedupeKey,
  parseSessionKey,
  legacySessionKeyToCanonical,
} from "@/lib/channels/ids"

describe("channels/ids", () => {
  it("sessionKey 与 parse 往返（含 TG 负 chatId）", () => {
    const key = makeSessionKey("tg", "-100123", "42")
    expect(key).toBe("tg:-100123:42")
    expect(parseSessionKey(key)).toEqual({
      channel: "tg",
      chatId: "-100123",
      userId: "42",
    })
  })

  it("legacy QQ 键升级", () => {
    expect(legacySessionKeyToCanonical("123:456")).toBe("qq:123:456")
    expect(legacySessionKeyToCanonical("qq:123:456")).toBe("qq:123:456")
  })

  it("dedupeKey", () => {
    expect(makeDedupeKey("qq", "1", "99")).toBe("qq:1:99")
  })

  it("非法 key 返回 null", () => {
    expect(parseSessionKey("nope")).toBeNull()
    expect(parseSessionKey("")).toBeNull()
  })
})
