import { describe, expect, it } from "vitest"
import {
  auditCorpusFiles,
  type CorpusFile,
} from "@/scripts/audit-kb-quality-recovery"

describe("auditCorpusFiles", () => {
  it("发现超长原始单元与旧路径重复时不报告 PASS", () => {
    const duplicate = `主题：API 报错\n${"细节".repeat(260)}`
    const files: CorpusFile[] = [
      { path: "retrieval/faq/api.md", text: duplicate },
      { path: "promoted/reflection-old.md", text: duplicate },
    ]

    const report = auditCorpusFiles(files, { maxChars: 500 })

    expect(report.status).toBe("FAIL")
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["OVERSIZED_UNIT", "DUPLICATE_PATH"])
    )
  })

  it("按生产分块规则统计干净语料", () => {
    const report = auditCorpusFiles([
      {
        path: "retrieval/faq/clean.md",
        text: "主题：短问题\n结论：短答案。\n\n主题：第二个问题\n结论：第二个答案。",
      },
    ])

    expect(report.status).toBe("PASS")
    expect(report.files).toBe(1)
    expect(report.units).toBe(2)
    expect(report.maxChars).toBeLessThanOrEqual(500)
  })
})
