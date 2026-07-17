import { describe, it, expect, beforeEach, vi } from "vitest"
import { bus } from "@/lib/bus"
import {
  registerErrorHandler,
  explainError,
  formatErrorLine,
  errorMessage,
} from "@/lib/agent/error-handler"
import { logger } from "@/lib/logger"

beforeEach(() => {
  bus.removeAllListeners()
  logger.clear()
})

describe("error handler", () => {
  it("带 sessionKey 的错误 → 兜底话术发回会话", async () => {
    registerErrorHandler({ logger: () => {} })
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("error.occurred", {
      scope: "test",
      err: new Error("boom"),
      sessionKey: "qq:7:8",
    })
    const a = await p
    expect(a.channel).toBe("qq")
    expect(a.chatId).toBe("7")
    expect(a.text).toContain("稍后")
  })

  it("历史两段 sessionKey 也能解析目标", async () => {
    registerErrorHandler({ logger: () => {} })
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("error.occurred", {
      scope: "test",
      err: new Error("boom"),
      sessionKey: "7:8",
    })
    const a = await p
    expect(a.channel).toBe("qq")
    expect(a.chatId).toBe("7")
  })

  it("userVisible=false 只记日志不回用户", async () => {
    registerErrorHandler({ logger: () => {} })
    const spy = vi.fn()
    bus.on("action.send", spy)
    bus.emit("error.occurred", {
      scope: "channel.send.qq",
      err: new Error("send fail"),
      channel: "qq",
      chatId: "1",
      userVisible: false,
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(spy).not.toHaveBeenCalled()
  })

  it("scope 以 channel.send 开头不回用户", async () => {
    registerErrorHandler({ logger: () => {} })
    const spy = vi.fn()
    bus.on("action.send", spy)
    bus.emit("error.occurred", {
      scope: "channel.send.tg",
      err: new Error("send fail"),
      channel: "tg",
      chatId: "-100",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(spy).not.toHaveBeenCalled()
  })

  it("自定义 logger 被调用", () => {
    const log = vi.fn()
    registerErrorHandler({ logger: log })
    bus.emit("error.occurred", { scope: "x", err: "e" })
    expect(log).toHaveBeenCalled()
  })

  it("默认路径写入结构化 logger(含分类与群号)", () => {
    registerErrorHandler()
    bus.emit("error.occurred", {
      scope: "reflection",
      channel: "qq",
      chatId: "10086",
      err: new Error(
        "Claude Code returned an error result: API Error: 500 input new_sensitive (1026). This is a server-side issue, usually temporary"
      ),
    })
    const lines = logger.tail()
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const e =
      lines.find((l) => l.code === "content_safety.input") ??
      lines[lines.length - 1]
    expect(e.scope).toBe("reflection")
    expect(e.groupId).toBe(10086)
    expect(e.category).toBe("content_safety")
    expect(e.retryable).toBe(false)
    expect(e.hint).toBeTruthy()
    expect(e.raw).toMatch(/new_sensitive/)
  })

  it("同错误去重累加", () => {
    registerErrorHandler()
    const err = new Error("API Error: 500 input new_sensitive (1026)")
    for (let i = 0; i < 3; i++) {
      bus.emit("error.occurred", {
        scope: "reflection",
        channel: "qq",
        chatId: "1",
        err,
      })
    }
    const hits = logger
      .tail()
      .filter((l) => l.scope === "reflection" && l.groupId === 1)
    expect(hits).toHaveLength(1)
    expect(hits[0].count).toBe(3)
  })

  it("unknown 错误 msg 保留 raw 摘要而非仅「未分类错误」", () => {
    registerErrorHandler()
    bus.emit("error.occurred", {
      scope: "topic",
      channel: "qq",
      chatId: "9",
      err: new Error("something totally unexpected xyz"),
    })
    const e = logger.tail().find((l) => l.scope === "topic")
    expect(e).toBeTruthy()
    expect(e!.code).toBe("unknown")
    expect(e!.msg).toContain("something totally unexpected xyz")
    expect(e!.raw).toContain("something totally unexpected xyz")
  })
})

describe("explainError / formatErrorLine 兼容", () => {
  it("errorMessage 支持 Error / string / 对象", () => {
    expect(errorMessage(new Error("x"))).toBe("x")
    expect(errorMessage("y")).toBe("y")
    expect(errorMessage({ a: 1 })).toBe('{"a":1}')
  })

  it("1026 new_sensitive → 内容安全说明", () => {
    const out = explainError(
      "API Error: 500 input new_sensitive (1026). This is a server-side issue"
    )
    expect(out).toMatch(/内容安全|输入/)
    expect(out).toContain("原始:")
  })

  it("formatErrorLine 从 sessionKey 解析群号", () => {
    const line = formatErrorLine({
      scope: "orchestrator",
      sessionKey: "qq:42:9",
      err: "oops",
    })
    expect(line).toContain("[orchestrator]")
    expect(line).toContain("群=42")
    expect(line).toContain("oops")
  })

  it("formatErrorLine 兼容历史两段 sessionKey", () => {
    const line = formatErrorLine({
      scope: "orchestrator",
      sessionKey: "42:9",
      err: "oops",
    })
    expect(line).toContain("群=42")
  })
})
