import { describe, expect, it } from "vitest"
import type { ReflectionEntry } from "@/lib/core/db/models"
import { splitCompactedFaq } from "@/lib/knowledge/reflection/compact-chunks"
import { promotionSourceAnswer } from "@/lib/knowledge/reflection/source-context"

function entry(overrides: Partial<ReflectionEntry> = {}): ReflectionEntry {
  return {
    id: 1,
    content: "完整 FAQ",
    channel: "qq",
    chatId: "0",
    ts: 100,
    question: null,
    answer: "完整 FAQ",
    status: "approved",
    ...overrides,
  }
}

function fragments(faq = "甲".repeat(500) + "乙".repeat(130)) {
  return splitCompactedFaq(faq).map((content, i) =>
    entry({ id: i + 1, content, answer: faq })
  )
}

describe("promotionSourceAnswer", () => {
  it("原始会话继续使用原始回答", () => {
    const original = entry({ chatId: "123", answer: "原始来源回答" })
    expect(promotionSourceAnswer(original, [])).toBe("原始来源回答")
    expect(promotionSourceAnswer({ ...original, answer: null }, [])).toBeNull()
  })

  it("完整且全部 approved 的同批 FAQ 返回完整来源", () => {
    const siblings = fragments()
    expect(promotionSourceAnswer(siblings[1], siblings)).toBe(
      siblings[1].answer
    )
  })

  it.each(["rejected", "promoted", "pending"] as const)(
    "兄弟块已 %s 时不重新引入完整 FAQ",
    (status) => {
      const siblings = fragments()
      siblings[1] = { ...siblings[1], status }
      expect(promotionSourceAnswer(siblings[0], siblings)).toBeNull()
    }
  )

  it("兄弟块被删除或待升格条目不在当前快照时不恢复", () => {
    const siblings = fragments()
    expect(promotionSourceAnswer(siblings[0], siblings.slice(0, 1))).toBeNull()
    expect(
      promotionSourceAnswer({ ...siblings[0], id: 99 }, siblings)
    ).toBeNull()
  })

  it.each([
    { ts: 101 },
    { answer: "其他 FAQ" },
    { channel: "tg" },
    { content: "同批但内容不匹配" },
  ])("不能从不同来源或内容的块凑齐兄弟组: %j", (overrides) => {
    const siblings = fragments()
    siblings[1] = { ...siblings[1], ...overrides }
    expect(promotionSourceAnswer(siblings[0], siblings)).toBeNull()
  })

  it("相同文本出现多次时按数量核对,额外块或重复 id 均拒绝", () => {
    const siblings = fragments("重复。\n\n重复。")
    expect(promotionSourceAnswer(siblings[0], siblings)).toBe(
      siblings[0].answer
    )
    expect(promotionSourceAnswer(siblings[0], siblings.slice(0, 1))).toBeNull()
    expect(
      promotionSourceAnswer(siblings[0], [
        ...siblings,
        { ...siblings[0], id: 3 },
      ])
    ).toBeNull()
    expect(
      promotionSourceAnswer(siblings[0], [siblings[0], siblings[0]])
    ).toBeNull()
  })

  it("缺少完整来源或批次时间的旧整理条目不猜测来源", () => {
    const current = entry()
    expect(
      promotionSourceAnswer({ ...current, answer: null }, [current])
    ).toBeNull()
    expect(
      promotionSourceAnswer({ ...current, answer: "  " }, [current])
    ).toBeNull()
    expect(
      promotionSourceAnswer({ ...current, ts: null }, [current])
    ).toBeNull()
  })
})
