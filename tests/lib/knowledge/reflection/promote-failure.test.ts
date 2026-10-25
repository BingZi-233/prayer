import { describe, it, expect } from "vitest"
import {
  countsAsEntryFailure,
  INTERNAL_FAULT_REASONS,
} from "@/lib/knowledge/reflection/promote-failure"

describe("countsAsEntryFailure", () => {
  it("成文校验类失败计次", () => {
    expect(countsAsEntryFailure("单元超长(612 > 500)")).toBe(true)
    expect(
      countsAsEntryFailure("成文含来源未支持的事实或限制,保留原条目")
    ).toBe(true)
    expect(countsAsEntryFailure("slug 非法")).toBe(true)
  })
  it("系统故障与并发变化不计次", () => {
    expect(INTERNAL_FAULT_REASONS.size).toBe(6)
    for (const r of INTERNAL_FAULT_REASONS)
      expect(countsAsEntryFailure(r)).toBe(false)
    expect(countsAsEntryFailure("条目不存在")).toBe(false)
    expect(countsAsEntryFailure("已驳回,不可升格")).toBe(false)
    expect(countsAsEntryFailure("反思来源在升格期间已变化,保留原条目")).toBe(
      false
    )
  })
})
