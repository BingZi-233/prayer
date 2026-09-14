import { describe, it, expect, beforeEach } from "vitest"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  isKbRelPath,
  isKbIngestibleRelPath,
  readKbFileBoundedNoFollow,
  readKbFileNoFollow,
  safeKbAbs,
  safeKbAbsAt,
  writeKbFileNoFollow,
  KB_ROOT,
  createKbFileNoFollow,
} from "@/lib/knowledge/kb-path"
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
  it("归档目录不进入生产 ingest", () => {
    expect(isKbIngestibleRelPath("retrieval/faq.md")).toBe(true)
    expect(isKbIngestibleRelPath("_archive/old.md")).toBe(false)
    expect(isKbIngestibleRelPath("promoted/_archive/old.md")).toBe(false)
  })
  it("safeKbAbs 解析到 KB_ROOT 下", () => {
    const p = safeKbAbs("faq/x.md")
    expect(p).toBeTruthy()
    expect(p!.startsWith(KB_ROOT)).toBe(true)
    expect(safeKbAbs("../x.md")).toBeNull()
  })

  it("拒绝 KB 根下指向外部的文件与目录 symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-kb-path-"))
    const outside = mkdtempSync(join(tmpdir(), "prayer-kb-outside-"))
    try {
      mkdirSync(join(root, "inside"))
      writeFileSync(join(root, "inside", "ok.md"), "ok")
      writeFileSync(join(outside, "secret.md"), "secret")
      symlinkSync(join(outside, "secret.md"), join(root, "leak.md"))
      symlinkSync(outside, join(root, "leak-dir"))
      expect(safeKbAbsAt(root, "inside/ok.md")).toBe(
        join(root, "inside", "ok.md")
      )
      expect(safeKbAbsAt(root, "leak.md")).toBeNull()
      expect(safeKbAbsAt(root, "leak-dir/passwd.md")).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("fd 读写不跟随最终文件 symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-kb-fd-"))
    const outside = mkdtempSync(join(tmpdir(), "prayer-kb-fd-outside-"))
    try {
      const target = join(root, "ok.md")
      const secret = join(outside, "secret.md")
      const link = join(root, "link.md")
      writeFileSync(target, "old")
      writeFileSync(secret, "keep")
      symlinkSync(secret, link)

      expect(readKbFileNoFollow(target)).toBe("old")
      expect(writeKbFileNoFollow(target, "new")).toBe(true)
      expect(readKbFileNoFollow(target)).toBe("new")
      expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual(
        []
      )
      expect(readKbFileNoFollow(link)).toBeNull()
      expect(writeKbFileNoFollow(link, "changed")).toBe(false)
      expect(readFileSync(secret, "utf8")).toBe("keep")
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("创建文件使用独占 fd 且固定为私有权限", () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-kb-create-"))
    try {
      const target = join(root, "new.md")
      expect(createKbFileNoFollow(target, "hello")).toBe(true)
      expect(readFileSync(target, "utf8")).toBe("hello")
      expect(statSync(target).mode & 0o777).toBe(0o600)
      expect(createKbFileNoFollow(target, "again")).toBe(false)
      expect(readFileSync(target, "utf8")).toBe("hello")
      expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual(
        []
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("bounded read 拒绝超大文档且不分配其完整内容", () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-kb-bounded-"))
    try {
      const target = join(root, "large.md")
      writeFileSync(target, "0123456789")
      expect(readKbFileBoundedNoFollow(target, 4)).toEqual({ tooLarge: true })
      expect(readKbFileBoundedNoFollow(target, 32)).toEqual({
        content: "0123456789",
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
