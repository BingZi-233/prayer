import { describe, it, expect, beforeEach } from "vitest"
import {
  logger,
  captureConsole,
  consoleLine,
  MAX_LOG_CONTEXT_CHARS,
  MAX_LOG_MESSAGE_CHARS,
  MAX_LOG_RAW_CHARS,
} from "@/lib/core/logger"

describe("logger ring buffer", () => {
  beforeEach(() => logger.clear())

  it("记录并读回", () => {
    logger.log("info", "hello")
    const lines = logger.tail()
    expect(lines).toHaveLength(1)
    expect(lines[0].msg).toBe("hello")
    expect(lines[0].level).toBe("info")
    expect(typeof lines[0].ts).toBe("number")
  })

  it("超过上限截断保留最新", () => {
    for (let i = 0; i < 2100; i++) logger.log("info", `m${i}`)
    const lines = logger.tail()
    expect(lines).toHaveLength(2000)
    expect(lines[0].msg).toBe("m100")
    expect(lines[1999].msg).toBe("m2099")
  })

  it("同内容不合并:逐条 append 且时间线单调不减", () => {
    for (let i = 0; i < 5; i++) {
      logger.error("输入被内容安全拦截", {
        scope: "reflection",
        channel: "qq",
        chatId: "100",
        raw: "API Error: 500 input new_sensitive (1026)",
      })
    }
    const lines = logger.tail()
    expect(lines).toHaveLength(5)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].ts).toBeGreaterThanOrEqual(lines[i - 1].ts)
    }
    expect(lines[0].channel).toBe("qq")
    expect(lines[0].chatId).toBe("100")
    expect(lines[0].scope).toBe("reflection")
  })

  it("error 不再产出分类字段", () => {
    logger.error("API Error: 500 input new_sensitive (1026). temporary")
    const e = logger.tail()[0]
    expect(e.level).toBe("error")
    expect(e.msg).toContain("new_sensitive")
    expect("code" in e).toBe(false)
    expect("category" in e).toBe(false)
    expect("count" in e).toBe(false)
  })

  it("限制消息、原文和上下文长度", () => {
    logger.error("m".repeat(MAX_LOG_MESSAGE_CHARS + 100), {
      scope: "s".repeat(MAX_LOG_CONTEXT_CHARS + 100),
      chatId: "c".repeat(MAX_LOG_CONTEXT_CHARS + 100),
      sessionKey: "k".repeat(MAX_LOG_CONTEXT_CHARS + 100),
      raw: "r".repeat(MAX_LOG_RAW_CHARS + 100),
    })
    const [entry] = logger.tail()
    expect(entry.msg).toHaveLength(MAX_LOG_MESSAGE_CHARS)
    expect(entry.raw).toHaveLength(MAX_LOG_RAW_CHARS)
    expect(entry.scope).toHaveLength(MAX_LOG_CONTEXT_CHARS)
    expect(entry.chatId).toHaveLength(MAX_LOG_CONTEXT_CHARS)
    expect(entry.sessionKey).toHaveLength(MAX_LOG_CONTEXT_CHARS)
    expect(entry.msg.endsWith("…")).toBe(true)
    expect(entry.raw?.endsWith("…")).toBe(true)
  })

  it("consoleLine 优先 raw 首行", () => {
    const line = consoleLine({
      ts: 0,
      level: "error",
      msg: "LLM 归类输出解析失败",
      scope: "topic",
      channel: "qq",
      chatId: "42",
      raw: "LLM 归类输出解析失败\nstack here",
    })
    expect(line).toContain("[topic]")
    expect(line).toContain("会话=qq:42")
    expect(line).toContain("LLM 归类输出解析失败")
    expect(line).not.toContain("stack here")
  })

  it("stdout 每条都写,不做汇总", () => {
    const out: string[] = []
    logger.setOrigConsole({
      log: (...a) => out.push(String(a[0])),
      warn: (...a) => out.push(String(a[0])),
      error: (...a) => out.push(String(a[0])),
    })
    logger.clear()
    for (let i = 0; i < 10; i++) {
      logger.error("输入被内容安全拦截", {
        scope: "reflection",
        channel: "qq",
        chatId: "100",
        raw: "API Error: 500 input new_sensitive (1026)",
      })
    }
    expect(out).toHaveLength(10)
    expect(out[9]).toContain("new_sensitive")
    expect(out.every((l) => !l.includes("×"))).toBe(true)
    // 清理,避免污染其它用例的 origConsole
    logger.setOrigConsole(null)
  })
})

describe("captureConsole", () => {
  // captureConsole 全局一次性
  it("captureConsole 捕获 Error 的 message(非 {})", () => {
    captureConsole()
    logger.clear()
    console.error(new Error("boom-unique-xyz"))
    const joined = logger
      .tail()
      .map((l) => l.msg + (l.raw ?? ""))
      .join("\n")
    expect(joined).toContain("boom-unique-xyz")
    expect(joined).not.toBe("{}")
  })

  it("captureConsole 原文进 ring 不被改写", () => {
    captureConsole()
    logger.clear()
    console.error("API Error: 500 input new_sensitive (1026)")
    const e = logger.tail().find((l) => l.msg.includes("new_sensitive"))
    expect(e).toBeTruthy()
    expect(e!.level).toBe("error")
    expect(e!.raw).toContain("new_sensitive")
  })
})
