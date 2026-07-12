import { describe, it, expect } from "vitest"
import { classifyItems } from "@/lib/agent/topic-poller"

describe("classifyItems 校验", () => {
  const existing = new Set([1, 2])
  it("结构化优先:合法项对齐;越界/重复/缺 i 丢弃;幻觉 topicId 丢弃", () => {
    const structured = {
      items: [
        { i: 0, topicId: 1 }, // 归入已有
        { i: 1, newTitle: "新主题" }, // 新建
        { i: 2, noise: true }, // 噪声丢弃
        { i: 3, topicId: 99 }, // 幻觉 id → 丢弃
        { i: 1, topicId: 2 }, // 重复 i → 丢弃
        { i: 9, topicId: 1 }, // 越界 → 丢弃
        { topicId: 1 }, // 缺 i → 丢弃
      ],
    }
    const out = classifyItems(structured, "", 4, existing)
    expect(out).toEqual([
      { i: 0, topicId: 1 },
      { i: 1, newTitle: "新主题" },
    ])
  })

  it("无结构化时回退文本解析", () => {
    const raw = '这是解释 {"items":[{"i":0,"topicId":2}]} 结尾'
    const out = classifyItems(undefined, raw, 1, existing)
    expect(out).toEqual([{ i: 0, topicId: 2 }])
  })

  it("解析失败 → 返回 null(调用方跳过、不推进游标)", () => {
    expect(classifyItems(undefined, "抱歉无法处理", 3, existing)).toBeNull()
  })

  it("structured 直接是数组时也能解析", () => {
    const out = classifyItems([{ i: 0, topicId: 1 }], "", 1, new Set([1]))
    expect(out).toEqual([{ i: 0, topicId: 1 }])
  })

  it("文本兜底解析裸数组", () => {
    const out = classifyItems(undefined, '前言 [{"i":0,"newTitle":"退款"}] 后语', 1, new Set([1]))
    expect(out).toEqual([{ i: 0, newTitle: "退款" }])
  })
})
