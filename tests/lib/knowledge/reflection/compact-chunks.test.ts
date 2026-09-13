import { describe, expect, it } from "vitest"
import { splitCompactedFaq } from "@/lib/knowledge/reflection/compact-chunks"

describe("splitCompactedFaq", () => {
  it("按生产 ingest 的段落规则与 500 字硬上限切分", () => {
    const chunks = splitCompactedFaq(
      `  第一段  \n\n${"长".repeat(501)}\n\n第三段\n\n\n`
    )

    expect(chunks).toEqual([
      "第一段",
      "长".repeat(500),
      "长",
      "第三段",
    ])
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true)
  })

  it("忽略空白段落，并在自定义上限下保持顺序", () => {
    expect(splitCompactedFaq("\n\n甲\n\n\n乙\n", 2)).toEqual([
      "甲",
      "乙",
    ])
  })

  it("空白输入返回空数组", () => {
    expect(splitCompactedFaq(" \n\n\t ")).toEqual([])
  })

  it("拒绝无法前进的分块上限", () => {
    expect(() => splitCompactedFaq("内容", 0)).toThrow(RangeError)
    expect(() => splitCompactedFaq("内容", 0.5)).toThrow(RangeError)
  })
})
