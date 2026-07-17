import { describe, it, expect } from "vitest"
import { bus } from "@/lib/bus"

describe("bus", () => {
  it("emit/on 传递类型化 payload", () => {
    let got: string | undefined
    bus.on("message.received", (p) => {
      got = p.chatId
    })
    bus.emit("message.received", {
      channel: "qq",
      chatId: "42",
      userId: "1",
      messageId: "1",
      rawText: "hi",
      atList: [],
    })
    expect(got).toBe("42")
  })

  it("是单例(同一引用)", async () => {
    const again = (await import("@/lib/bus")).bus
    expect(again).toBe(bus)
  })
})
