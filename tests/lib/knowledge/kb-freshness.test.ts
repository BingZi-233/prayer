import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"
import { checkKbFreshness } from "@/lib/knowledge/kb-freshness"
import { MAX_KB_FILE_BYTES } from "@/lib/knowledge/kb-path"

describe("KB freshness", () => {
  let root: string
  let repo: Repo

  beforeEach(() => {
    root = join(tmpdir(), `kb-freshness-${Date.now()}-${Math.random()}`)
    mkdirSync(root, { recursive: true })
    repo = new Repo(openDb(":memory:", 3))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("磁盘分块、索引内容、向量数量和维度一致时通过", () => {
    writeFileSync(join(root, "faq.md"), "第一段\n\n第二段")
    repo.insertKbEntry(
      "faq.md",
      "第一段",
      "faq.md",
      new Float32Array([1, 0, 0])
    )
    repo.insertKbEntry(
      "faq.md",
      "第二段",
      "faq.md",
      new Float32Array([0, 1, 0])
    )

    const report = checkKbFreshness(repo, root, 3, () => 123)
    expect(report.status).toBe("PASS")
    expect(report.checkedAt).toBe(123)
    expect(report.expectedChunks).toBe(2)
    expect(report.indexedVectors).toBe(2)
    expect(report.entries[0]).toMatchObject({
      path: "faq.md",
      expectedChunks: 2,
      indexedChunks: 2,
      indexedVectors: 2,
    })
    expect(report.entries[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it("文件变更或向量缺失时失败并指出文档", () => {
    writeFileSync(join(root, "faq.md"), "新内容")
    repo.insertKbEntry(
      "faq.md",
      "旧内容",
      "faq.md",
      new Float32Array([1, 0, 0])
    )
    repo.insertKbChunk("partial.md", "只有 chunk", "partial.md")
    writeFileSync(join(root, "partial.md"), "只有 chunk")

    const report = checkKbFreshness(repo, root, 3)
    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CHUNK_CONTENT_MISMATCH",
          path: "faq.md",
        }),
        expect.objectContaining({
          code: "VECTOR_COUNT_MISMATCH",
          path: "partial.md",
        }),
      ])
    )
  })

  it("索引孤儿文档与错误维度失败，但 human-reflection 保留为 DB 专属文档", () => {
    writeFileSync(join(root, "faq.md"), "正文")
    repo.insertKbEntry("faq.md", "正文", "faq.md", new Float32Array([1, 0, 0]))
    repo.insertKbEntry(
      "orphan.md",
      "旧文档",
      "orphan.md",
      new Float32Array([1, 0, 0])
    )
    repo.insertKbEntry(
      "human-reflection",
      "反思",
      "human-reflection",
      new Float32Array([1, 0, 0])
    )

    const report = checkKbFreshness(repo, root, 512)
    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ORPHAN_INDEX_DOC",
          path: "orphan.md",
        }),
        expect.objectContaining({
          code: "VECTOR_DIMENSION_MISMATCH",
          path: "kb_vec",
        }),
      ])
    )
    expect(report.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ORPHAN_INDEX_DOC",
          path: "human-reflection",
        }),
      ])
    )
  })

  it("有向量但无法读取维度时 fail-closed", () => {
    writeFileSync(join(root, "faq.md"), "正文")
    repo.insertKbEntry("faq.md", "正文", "faq.md", new Float32Array([1, 0, 0]))
    const dimension = vi.spyOn(repo, "kbVectorDimension").mockReturnValue(null)
    try {
      const report = checkKbFreshness(repo, root, 3)
      expect(report.status).toBe("FAIL")
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "VECTOR_DIMENSION_MISMATCH",
            detail: "索引存在向量但无法解析其 embedding 维度",
          }),
        ])
      )
    } finally {
      dimension.mockRestore()
    }
  })

  it("检测 vec0 中没有对应 chunk 的孤儿向量", () => {
    writeFileSync(join(root, "faq.md"), "正文")
    repo.insertKbEntry("faq.md", "正文", "faq.md", new Float32Array([1, 0, 0]))
    // vec0 的 chunk_id 没有外键约束，异常路径可能留下孤儿向量。
    repo.insertKbVec(999_999, new Float32Array([0, 1, 0]))

    const report = checkKbFreshness(repo, root, 3)
    expect(report.status).toBe("FAIL")
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ORPHAN_INDEX_VECTOR",
          path: "kb_vec",
          detail: expect.stringContaining("1 个"),
        }),
      ])
    )
  })

  it("与 ingest 一样忽略归档目录", () => {
    mkdirSync(join(root, "_archive"), { recursive: true })
    writeFileSync(join(root, "_archive", "old.md"), "历史内容")
    writeFileSync(join(root, "active.md"), "当前内容")
    repo.insertKbEntry(
      "active.md",
      "当前内容",
      "active.md",
      new Float32Array([1, 0, 0])
    )

    const report = checkKbFreshness(repo, root, 3)
    expect(report.status).toBe("PASS")
    expect(report.files).toBe(1)
    expect(report.entries[0]?.path).toBe("active.md")
  })

  it("拒绝指向知识库根目录外的符号链接，并对缺失根目录返回失败报告", () => {
    const outside = join(
      tmpdir(),
      `kb-outside-${Date.now()}-${Math.random()}.md`
    )
    writeFileSync(outside, "不应入库")
    try {
      symlinkSync(outside, join(root, "leak.md"))
      const report = checkKbFreshness(repo, root, 3)
      expect(report.status).toBe("FAIL")
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "SYMLINK_OUTSIDE_ROOT",
            path: "leak.md",
          }),
        ])
      )
    } finally {
      rmSync(outside, { force: true })
    }

    const missing = join(root, "missing")
    const missingReport = checkKbFreshness(repo, missing, 3)
    expect(missingReport.status).toBe("FAIL")
    expect(missingReport.issues[0]?.code).toBe("FILE_READ_ERROR")
  })

  it("根目录本身是符号链接时 fail-closed", () => {
    const target = join(tmpdir(), `kb-target-${Date.now()}-${Math.random()}`)
    mkdirSync(target, { recursive: true })
    const link = join(root, "root-link")
    symlinkSync(target, link)
    try {
      const report = checkKbFreshness(repo, link, 3)
      expect(report.status).toBe("FAIL")
      expect(report.issues[0]?.code).toBe("SYMLINK_OUTSIDE_ROOT")
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it("超大文档不被 freshness 检查无界读入", () => {
    writeFileSync(join(root, "huge.md"), Buffer.alloc(MAX_KB_FILE_BYTES + 1))
    const report = checkKbFreshness(repo, root, 3)
    expect(report.status).toBe("FAIL")
    expect(report.files).toBe(0)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "FILE_READ_ERROR",
          path: "huge.md",
          detail: expect.stringContaining("字节上限"),
        }),
      ])
    )
  })
})
