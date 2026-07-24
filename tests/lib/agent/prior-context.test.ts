import { describe, it, expect } from "vitest"
import {
  PRIOR_LINE_MAX_CHARS,
  EMPTY_AT_PLACEHOLDER,
  clipPriorTexts,
  formatPriorContext,
} from "@/lib/agent/prior-context"

describe("formatPriorContext", () => {
  it("无 prior 时原样返回 body", () => {
    expect(formatPriorContext([], "你好")).toBe("你好")
  })

  it("有 prior + body 时拼出近期发言与当前消息", () => {
    const out = formatPriorContext(["旧话", "新话"], "当前")
    expect(out).toBe(
      "【用户近期发言（@前，旧→新）】\n- 旧话\n- 新话\n【当前消息】\n当前"
    )
  })

  it("有 prior 且 body 为空时用 EMPTY_AT_PLACEHOLDER", () => {
    const out = formatPriorContext(["之前说的"], "   ")
    expect(out).toContain(EMPTY_AT_PLACEHOLDER)
    expect(out).toBe(
      `【用户近期发言（@前，旧→新）】\n- 之前说的\n【当前消息】\n${EMPTY_AT_PLACEHOLDER}`
    )
  })

  it("多行经 clip 再 format 时续行有两空格缩进", () => {
    const clipped = clipPriorTexts(
      ["第一行\n第二行"],
      2000,
      PRIOR_LINE_MAX_CHARS
    )
    expect(clipped).toEqual(["第一行\n  第二行"])
    const out = formatPriorContext(clipped, "当前")
    expect(out).toContain("- 第一行\n  第二行")
  })
})

describe("clipPriorTexts", () => {
  it("单行超过 PRIOR_LINE_MAX_CHARS 时以 … 结尾", () => {
    const long = "甲".repeat(PRIOR_LINE_MAX_CHARS + 50)
    const [line] = clipPriorTexts([long], 10_000, PRIOR_LINE_MAX_CHARS)
    expect(line.endsWith("…")).toBe(true)
    expect(line.length).toBe(PRIOR_LINE_MAX_CHARS)
  })

  it("字符预算优先保留较新消息", () => {
    // 每条约 11 字符 + 3 开销 ≈ 14；预算 30 只够装最新两条
    const texts = ["旧消息AAAAAAAA", "中消息BBBBBBBB", "新消息CCCCCCCC"]
    const kept = clipPriorTexts(texts, 30, PRIOR_LINE_MAX_CHARS)
    expect(kept).toEqual(["中消息BBBBBBBB", "新消息CCCCCCCC"])
    expect(kept).not.toContain("旧消息AAAAAAAA")
  })
})
