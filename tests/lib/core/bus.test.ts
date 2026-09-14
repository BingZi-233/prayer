import { afterEach, describe, it, expect } from "vitest"
import { bus, emitErrorSafely } from "@/lib/core/bus"

afterEach(() => bus.removeAllListeners())

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
    const again = (await import("@/lib/core/bus")).bus
    expect(again).toBe(bus)
  })

  it("安全上报不会把 observer 异常抛回调用方", () => {
    bus.on("error.occurred", () => {
      throw new Error("observer boom")
    })

    expect(() =>
      emitErrorSafely({
        scope: "test",
        err: new Error("source boom"),
        userVisible: false,
      })
    ).not.toThrow()
  })

  it("单个 observer 异常不阻断后续 observer，并保留 once 语义", () => {
    const seen: string[] = []
    bus.on("error.occurred", () => {
      seen.push("bad")
      throw new Error("observer boom")
    })
    bus.once("error.occurred", () => seen.push("once"))
    bus.on("error.occurred", () => seen.push("good"))

    emitErrorSafely({ scope: "test", err: "source", userVisible: false })
    emitErrorSafely({ scope: "test", err: "source", userVisible: false })

    expect(seen).toEqual(["bad", "once", "good", "bad", "good"])
  })
})
