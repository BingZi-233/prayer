import { describe, it, expect, beforeEach } from "vitest"
import { isKbRelPath, safeKbAbs, KB_ROOT } from "@/lib/kb-path"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"

describe("kb-path", () => {
  it("接受合法相对路径", () => {
    expect(isKbRelPath("faq/x.md")).toBe(true)
    expect(isKbRelPath("Monitor.md")).toBe(true)
    expect(isKbRelPath("a/b/c.txt")).toBe(true)
  })
  it("拒绝穿越与非法后缀", () => {
    expect(isKbRelPath("../secret.md")).toBe(false)
    expect(isKbRelPath("a/../../etc/passwd.md")).toBe(false)
    expect(isKbRelPath("/abs.md")).toBe(false)
    expect(isKbRelPath("foo.js")).toBe(false)
    expect(isKbRelPath("")).toBe(false)
    expect(isKbRelPath("a//b.md")).toBe(false)
  })
  it("safeKbAbs 解析到 KB_ROOT 下", () => {
    const p = safeKbAbs("faq/x.md")
    expect(p).toBeTruthy()
    expect(p!.startsWith(KB_ROOT)).toBe(true)
    expect(safeKbAbs("../x.md")).toBeNull()
  })
})

describe("Repo deleteKbDoc / renameKbDoc", () => {
  let repo: Repo
  const vec = () => new Float32Array([1, 0, 0])

  beforeEach(() => {
    repo = new Repo(openDb(":memory:", 3))
  })

  it("deleteKbDoc 清 chunk+vec", () => {
    repo.insertKbEntry("faq/a.md", "内容A", "faq/a.md", vec())
    repo.insertKbEntry("faq/b.md", "内容B", "faq/b.md", vec())
    expect(repo.deleteKbDoc("faq/a.md")).toBe(1)
    expect(repo.kbChunksByDoc("faq/a.md")).toHaveLength(0)
    expect(repo.kbChunksByDoc("faq/b.md")).toHaveLength(1)
  })

  it("renameKbDoc 更新 doc 与同值 source", () => {
    repo.insertKbEntry("old.md", "正文", "old.md", vec())
    expect(repo.renameKbDoc("old.md", "new.md")).toBe(1)
    expect(repo.kbChunksByDoc("old.md")).toHaveLength(0)
    const rows = repo.kbChunksByDoc("new.md")
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe("正文")
  })
})
