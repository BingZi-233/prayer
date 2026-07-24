import { describe, it, expect } from "vitest"
import {
  extractJsonValues,
  findBalancedEnd,
  pickArrayFieldDual,
  previewJsonPayload,
  salvageArrayObjects,
} from "@/lib/agent/json-output"

describe("findBalancedEnd / extractJsonValues", () => {
  it("配对对象与数组", () => {
    const s = `前置{"a":1}中缀[2,3]`
    expect(findBalancedEnd(s, s.indexOf("{"))).toBe(s.indexOf("}"))
    expect(findBalancedEnd(s, s.indexOf("["))).toBe(s.indexOf("]"))
  })

  it("字符串内括号不计深度", () => {
    const s = `{"x":"a}b","y":1}`
    expect(findBalancedEnd(s, 0)).toBe(s.length - 1)
    expect(JSON.parse(s.slice(0, findBalancedEnd(s, 0) + 1))).toEqual({
      x: "a}b",
      y: 1,
    })
  })

  it("多轮拼接抽出多个顶层值", () => {
    const s = `{"items":[1]}{"items":[2,3]}`
    expect(extractJsonValues(s)).toEqual([{ items: [1] }, { items: [2, 3] }])
  })
})

describe("pickArrayFieldDual", () => {
  it("structured {items} 优先", () => {
    const r = pickArrayFieldDual(
      { items: [{ faq: "A" }] },
      `{"items":[{"faq":"B"}]}`,
      "items"
    )
    expect(r).toEqual({
      items: [{ faq: "A" }],
      truncated: false,
      source: "structured",
    })
  })

  it("无 structured 时文本兜底", () => {
    const r = pickArrayFieldDual(
      undefined,
      `说明如下\n{"items":[{"faq":"从文本"}]}\n`,
      "items"
    )
    expect(r?.source).toBe("text")
    expect(r?.items).toEqual([{ faq: "从文本" }])
  })

  it("多轮拼接取最后一个", () => {
    const r = pickArrayFieldDual(
      undefined,
      `{"items":[{"faq":"旧"}]}{"items":[{"faq":"新"}]}`,
      "items"
    )
    expect(r?.items).toEqual([{ faq: "新" }])
  })

  it("decisions 不接受裸数组", () => {
    expect(
      pickArrayFieldDual([{ id: 1, promote: true }], "", "decisions", {
        allowBareArray: false,
      })
    ).toBeNull()
    expect(
      pickArrayFieldDual(
        undefined,
        `{"decisions":[{"id":1,"promote":false,"reason":"x"}]}`,
        "decisions",
        { allowBareArray: false }
      )?.items
    ).toEqual([{ id: 1, promote: false, reason: "x" }])
  })

  it("截断数组 salvage", () => {
    const s = `[{"faq":"完整1"},{"faq":"完整2"},{"faq":"半截`
    const r = pickArrayFieldDual(undefined, s, "items", {
      salvageTruncated: true,
    })
    expect(r?.truncated).toBe(true)
    expect(r?.items).toEqual([{ faq: "完整1" }, { faq: "完整2" }])
  })
})

describe("salvageArrayObjects / previewJsonPayload", () => {
  it("salvage 跳过半截对象", () => {
    const s = `[{"a":1},{"b":2},{"c":`
    expect(salvageArrayObjects(s, 0)).toEqual([{ a: 1 }, { b: 2 }])
  })

  it("preview 优先文本", () => {
    expect(previewJsonPayload({ items: [] }, "  hello world  ", 5)).toBe(
      "hello"
    )
  })
})
