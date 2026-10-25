import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
  reviewBadge,
  reviewNoteLine,
} from "@/components/admin/reflection/review-label"

describe("反思条目评审账本展示", () => {
  it("各账本状态对应的徽标文案", () => {
    const base = { reviewAttempts: 0, reviewNote: null }
    expect(reviewBadge({ ...base, reviewState: null })).toBeNull()
    expect(reviewBadge({ ...base, reviewState: "legacy" })?.text).toBe(
      "存量待处置"
    )
    expect(reviewBadge({ ...base, reviewState: "accepted" })?.text).toBe(
      "待成文"
    )
    expect(reviewBadge({ ...base, reviewState: "declined" })?.text).toBe(
      "评审未通过"
    )
  })

  it("failed 显示次数,title 带原因", () => {
    const b = reviewBadge({
      reviewState: "failed",
      reviewAttempts: 2,
      reviewNote: "超时",
    })
    expect(b).toMatchObject({
      text: "升格失败 2 次",
      variant: "destructive",
      title: "超时",
    })
  })

  it("超预算预过滤的 failed(attempts=0)不显示「0 次」", () => {
    const b = reviewBadge({
      reviewState: "failed",
      reviewAttempts: 0,
      reviewNote: "超过字数预算",
    })
    expect(b?.text).toBe("升格失败")
    expect(b?.text).not.toContain("0")
  })

  it("有 note 就出备注行,含 null 状态下的手动失败 note", () => {
    expect(
      reviewNoteLine({
        reviewState: "failed",
        reviewAttempts: 0,
        reviewNote: "超过字数预算",
      })
    ).toBe("最近升格失败:超过字数预算")
    expect(
      reviewNoteLine({
        reviewState: null,
        reviewAttempts: 0,
        reviewNote: "手动升格调用异常",
      })
    ).toBe("最近升格失败:手动升格调用异常")
    expect(
      reviewNoteLine({
        reviewState: "declined",
        reviewAttempts: 0,
        reviewNote: "与现有文档重复",
      })
    ).toBe("评审备注:与现有文档重复")
    expect(
      reviewNoteLine({
        reviewState: "accepted",
        reviewAttempts: 1,
        reviewNote: null,
      })
    ).toBeNull()
  })

  it("条目行接入徽标与备注行,且不再有「已整理」徽标", async () => {
    const src = await readFile(
      "components/admin/reflection/entry-row.tsx",
      "utf8"
    )
    expect(src).toContain("reviewBadge(e)")
    expect(src).toContain("reviewNoteLine(")
    expect(src).not.toContain("已整理")
  })
})
