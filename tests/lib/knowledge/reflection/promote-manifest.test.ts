import { describe, it, expect } from "vitest"
import {
  formatDate,
  promoteManifest,
  promoteManifestRel,
  promoteSnapshotRel,
  sha256Hex,
  type PromoteManifestInput,
} from "@/lib/knowledge/reflection/promote-manifest"

/** 所有路径字段都是「相对 docs/kb」的 posix 路径,渲染时才加前缀。 */
function input(over: Partial<PromoteManifestInput> = {}): PromoteManifestInput {
  return {
    chunkId: 42,
    variant: "promotion",
    decision: "merge",
    target: "retrieval/faq/api-errors.md",
    originalPath: "retrieval/faq/api-errors.md",
    retiredPath: null,
    relocationReason: null,
    preEditSnapshot: "_meta/2026-09-16-promote-42-pre-edit.md.disabled",
    preSha256: "a".repeat(64),
    postSha256: "b".repeat(64),
    sourceStatus: "QQ 群客服会话反思 #42",
    volatility: "错误文案随版本变化",
    chunks: ["第一段", "第二段"],
    embeddedChunks: 2,
    dimension: 512,
    rolledBack: false,
    date: "2026-09-16",
    ...over,
  }
}

describe("台账路径", () => {
  it("manifest 与快照都不匹配 ingest 可入库后缀", () => {
    expect(promoteManifestRel("2026-09-16", 42)).toBe(
      "_meta/2026-09-16-promote-42-manifest.md.disabled"
    )
    expect(promoteSnapshotRel("2026-09-16", 7)).toBe(
      "_meta/2026-09-16-promote-7-pre-edit.md.disabled"
    )
    // 台账绝不能以 .md / .txt 结尾,否则会被 pnpm ingest 吃成语料
    for (const rel of [
      promoteManifestRel("2026-09-16", 42),
      promoteSnapshotRel("2026-09-16", 42),
    ]) {
      expect(rel.endsWith(".md") || rel.endsWith(".txt")).toBe(false)
    }
  })
})

describe("formatDate / sha256Hex", () => {
  it("按 UTC 出日期,避免部署时区让同一记录反复变动", () => {
    expect(formatDate(Date.UTC(2026, 8, 16, 23, 30))).toBe("2026-09-16")
    expect(formatDate(Date.UTC(2026, 8, 17, 0, 30))).toBe("2026-09-17")
  })

  it("hash 是 utf8 的 sha256 hex", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
  })
})

describe("promoteManifest", () => {
  it("升格 merge:每个路径字段都带 docs/kb 前缀", () => {
    const md = promoteManifest(input())
    expect(md).toContain(
      "- decision：merge（追加到既有 canonical 文档，非新建文件）"
    )
    expect(md).toContain("- target：docs/kb/retrieval/faq/api-errors.md")
    expect(md).toContain("- original_path：docs/kb/retrieval/faq/api-errors.md")
    expect(md).toContain("- active_path：docs/kb/retrieval/faq/api-errors.md")
    expect(md).toContain("- retired_path：无（未发生迁移/下线）")
    expect(md).toContain(
      "- pre-edit snapshot：docs/kb/_meta/2026-09-16-promote-42-pre-edit.md.disabled"
    )
  })

  it("升格:哈希、结果与结构预检", () => {
    const md = promoteManifest(input())
    expect(md).toContain("- pre-edit SHA-256：" + "a".repeat(64))
    expect(md).toContain("- post-edit SHA-256：" + "b".repeat(64))
    expect(md).toContain("- result：committed")
    expect(md).toContain("整份文档 2 段")
    expect(md).toContain("无 ISOLATED_HEADING")
    expect(md).toContain("索引向量维度：512")
    expect(md).toContain("本次写入向量段数：2")
    expect(md).toContain("- db_write：in-process applyPromote")
    expect(md).toContain("pnpm ingest：不需要")
    expect(md).not.toContain("## 迁移说明")
    expect(md).not.toContain("- db_write：迁移脚本")
  })

  it("新建文件时路径与 pre-edit 哈希标为无", () => {
    const md = promoteManifest(
      input({
        decision: "new",
        originalPath: null,
        preEditSnapshot: null,
        preSha256: null,
      })
    )
    expect(md).toContain("- decision：new（新建 retrieval/ 文档）")
    expect(md).toContain("- original_path：无（新建文件）")
    expect(md).toContain("- pre-edit snapshot：无（新建文件）")
    expect(md).toContain("- pre-edit SHA-256：无（新建文件）")
  })

  it("migration 变体:decision 行写明迁移并渲染迁移小节", () => {
    const md = promoteManifest(
      input({
        variant: "migration",
        originalPath: "promoted/reflection-198794.md",
        retiredPath: "promoted/reflection-198794.md.disabled",
        relocationReason:
          "promoted/ 是历史层,而原文件仍是 ingest 可见的活跃语料",
        preEditSnapshot: "_meta/2026-09-16-faq-api-errors-pre-edit.md.disabled",
      })
    )
    expect(md).toContain(
      "- decision：merge（历史迁移：原 promoted/ 文件并入既有 canonical 文档）"
    )
    expect(md).toContain(
      "- original_path：docs/kb/promoted/reflection-198794.md"
    )
    expect(md).toContain(
      "- retired_path：docs/kb/promoted/reflection-198794.md.disabled"
    )
    expect(md).toContain("## 迁移说明")
    expect(md).toContain(
      "- 缘由：promoted/ 是历史层,而原文件仍是 ingest 可见的活跃语料"
    )
    expect(md).toContain(
      "- 退役为：docs/kb/promoted/reflection-198794.md.disabled"
    )
    // 迁移只改磁盘,向量要等显式授权后重建:写成"不需要"就是假记录,
    // 且与它自己那行「本次写入向量段数」自相矛盾
    expect(md).toContain("- db_write：迁移脚本直接改磁盘")
    expect(md).toContain("pnpm ingest：需要（本次只改文档")
    expect(md).not.toContain("pnpm ingest：不需要")
  })

  it("migration + new:decision 行走迁移的新建分支", () => {
    const md = promoteManifest(
      input({ variant: "migration", decision: "new", originalPath: null })
    )
    expect(md).toContain(
      "- decision：new（历史迁移：原 promoted/ 文件改建 retrieval/ 文档）"
    )
  })

  it("rollback 变体写明文件已回滚", () => {
    const md = promoteManifest(input({ rolledBack: true }))
    expect(md).toContain("- result：rolled_back")
    expect(md).toContain("条目保留")
  })

  it("单段超限时报出具体最长值", () => {
    const md = promoteManifest(input({ chunks: ["x".repeat(501)] }))
    expect(md).toContain("超限（最长 501）")
  })

  it("空分块与空索引时回落成可读占位而不是 undefined", () => {
    const md = promoteManifest(
      input({ chunks: [], embeddedChunks: 0, dimension: null })
    )
    expect(md).toContain("各段字符数 无")
    expect(md).toContain("最长 0")
    expect(md).toContain("索引向量维度：未知（空索引）")
    expect(md).not.toContain("undefined")
  })
})
