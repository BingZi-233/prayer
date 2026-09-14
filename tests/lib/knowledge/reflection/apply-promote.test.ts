import { describe, expect, it, vi } from "vitest"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import {
  applyPromote,
  promotedDocRel,
  promotedMarkdown,
} from "@/lib/knowledge/reflection/apply-promote"

const vec = () => new Float32Array([1, 0, 0])
const asyncVec = async () => vec()

function makeRepo() {
  return new Repo(openDb(":memory:", 3))
}

function seedReflection(repo: Repo): number {
  return repo.insertKbEntry(
    "human-reflection",
    "退款 3 天到账",
    "human-reflection:qq:100:1700",
    vec()
  )
}

function fakeFs() {
  const files = new Map<string, string>()
  return {
    files,
    writeFileFn: vi.fn(async (p: string, b: string) => {
      files.set(p, b)
    }),
    mkdirFn: vi.fn(async () => {}),
  }
}

describe("promotedMarkdown / promotedDocRel", () => {
  it("正文格式与路径稳定", () => {
    expect(promotedMarkdown(7, "  内容  \n")).toBe("# 升格反思 #7\n\n内容\n")
    expect(promotedDocRel(7)).toBe("promoted/reflection-7.md")
  })
})

describe("applyPromote", () => {
  it("升格:正式文档入库、原反思 chunk 删除、文件写入", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()

    const r = await applyPromote({
      repo,
      chunkId: id,
      embed: asyncVec,
      cwd: "/w",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file).toBe("promoted/reflection-1.md")
    // 正式文档(doc=rel)入库,检索可命中
    expect(repo.kbDocStats().map((d) => d.doc)).toContain(r.file)
    expect(
      repo.searchBaseKb(vec(), 5).some((h) => h.content.includes("升格反思"))
    ).toBe(true)
    expect(repo.kbChunksByDoc(r.file).map((chunk) => chunk.content)).toEqual([
      "# 升格反思 #1",
      "退款 3 天到账",
    ])
    // 原反思条目已删:不在 human-reflection 列表
    expect(repo.countReflectionEntries()).toBe(0)
    // 文件写到 docs/kb/promoted/
    expect([...fs.files.keys()]).toContain(
      "/w/docs/kb/promoted/reflection-1.md"
    )
  })

  it("二次升格:chunk+meta 已随升格删除,按原语义返回「条目不存在」", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()
    const base = {
      repo,
      chunkId: id,
      embed: asyncVec,
      cwd: "/w",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
    }
    await applyPromote(base)
    // already 分支只防御「状态=promoted 但 chunk 未删」的历史形态;
    // 正常流程升格即物理删除(deleteKbChunk 级联删 meta),二次升格走「不存在」
    const again = await applyPromote(base)
    expect(again).toEqual({ ok: false, reason: "条目不存在" })
    expect(fs.writeFileFn).toHaveBeenCalledTimes(1)
  })

  it("同一条目的并发升格会串行,只提交一次", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()
    let release!: () => void
    const firstEmbedding = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const embed = vi.fn(async () => {
      started()
      await firstEmbedding
      return vec()
    })
    const opts = {
      repo,
      chunkId: id,
      embed,
      cwd: "/concurrent",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
    }

    const first = applyPromote(opts)
    await firstStarted
    const second = applyPromote(opts)
    release()

    expect((await first).ok).toBe(true)
    expect(await second).toEqual({ ok: false, reason: "条目不存在" })
    // The shared ingest splitter yields a heading chunk and a body chunk.
    expect(embed).toHaveBeenCalledTimes(2)
    expect(fs.writeFileFn).toHaveBeenCalledTimes(1)
  })

  it("embed 失败:DB 完全未动,条目保留可重试", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()

    await expect(
      applyPromote({
        repo,
        chunkId: id,
        embed: () => Promise.reject(new Error("embed 挂了")),
        cwd: "/w",
        writeFileFn: fs.writeFileFn,
        mkdirFn: fs.mkdirFn,
      })
    ).rejects.toThrow("embed 挂了")

    // 条目仍在,且状态未变
    expect(repo.countReflectionEntries()).toBe(1)
    expect(repo.reflectionEntryDetail(id)?.status).toBe("approved")
    // 正式文档未入库
    expect(repo.kbTotals().chunks).toBe(1)
  })

  it("DB 步骤失败整体回滚:原反思条目不被误删", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    // 在事务内插一条会炸的路径:覆写 insertKbEntry 抛错
    const broken = Object.create(repo) as Repo
    broken.insertKbEntry = () => {
      throw new Error("向量写入失败")
    }
    const fs = fakeFs()

    await expect(
      applyPromote({
        repo: broken,
        chunkId: id,
        embed: asyncVec,
        cwd: "/w",
        writeFileFn: fs.writeFileFn,
        mkdirFn: fs.mkdirFn,
      })
    ).rejects.toThrow("向量写入失败")

    // 回滚:原反思条目仍在(deleteKbChunk 未生效)
    expect(repo.countReflectionEntries()).toBe(1)
    expect(repo.reflectionEntryDetail(id)?.content).toBe("退款 3 天到账")
    expect(repo.kbTotals().chunks).toBe(1)
  })

  it("不存在 / 已驳回:拒绝升格", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    repo.setReflectionStatus(id, "rejected")
    const fs = fakeFs()
    const opts = {
      repo,
      embed: asyncVec,
      cwd: "/w",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
    }
    expect((await applyPromote({ ...opts, chunkId: 999 })).ok).toBe(false)
    const r = await applyPromote({ ...opts, chunkId: id })
    expect(r).toEqual({ ok: false, reason: "已驳回,不可升格" })
    expect(fs.writeFileFn).not.toHaveBeenCalled()
  })

  it("只注入 writer 时仍执行路径 guard,不触碰默认 mkdir", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const writer = vi.fn(async () => {})

    const r = await applyPromote({
      repo,
      chunkId: id,
      embed: asyncVec,
      cwd: "/path-that-does-not-exist",
      writeFileFn: writer,
    })

    expect(r).toEqual({ ok: false, reason: "知识库路径非法" })
    expect(writer).not.toHaveBeenCalled()
    expect(repo.countReflectionEntries()).toBe(1)
  })

  it("默认写盘使用同目录临时文件并原子替换", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      mkdirSync(join(root, "docs/kb"), { recursive: true })
      const repo = makeRepo()
      const id = seedReflection(repo)

      const r = await applyPromote({
        repo,
        chunkId: id,
        embed: asyncVec,
        cwd: root,
      })

      expect(r.ok).toBe(true)
      const promoted = join(root, "docs/kb/promoted")
      expect(readFileSync(join(promoted, "reflection-1.md"), "utf8")).toBe(
        promotedMarkdown(1, "退款 3 天到账")
      )
      expect(readdirSync(promoted)).toEqual(["reflection-1.md"])
      expect(readdirSync(promoted).some((name) => name.endsWith(".tmp"))).toBe(
        false
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("embed 失败清理临时文件且保留现有正式文件", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const promoted = join(root, "docs/kb/promoted")
      mkdirSync(promoted, { recursive: true })
      const target = join(promoted, "reflection-1.md")
      writeFileSync(target, "旧版本\n")
      const repo = makeRepo()
      const id = seedReflection(repo)

      await expect(
        applyPromote({
          repo,
          chunkId: id,
          embed: () => Promise.reject(new Error("embed 挂了")),
          cwd: root,
        })
      ).rejects.toThrow("embed 挂了")

      expect(readFileSync(target, "utf8")).toBe("旧版本\n")
      expect(readdirSync(promoted)).toEqual(["reflection-1.md"])
      expect(readdirSync(promoted).some((name) => name.endsWith(".tmp"))).toBe(
        false
      )
      expect(repo.countReflectionEntries()).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("DB 失败恢复现有正式文件并清理临时文件", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const promoted = join(root, "docs/kb/promoted")
      mkdirSync(promoted, { recursive: true })
      const target = join(promoted, "reflection-1.md")
      writeFileSync(target, "旧版本\n")
      const repo = makeRepo()
      const id = seedReflection(repo)
      const broken = Object.create(repo) as Repo
      broken.insertKbEntry = () => {
        throw new Error("向量写入失败")
      }

      await expect(
        applyPromote({
          repo: broken,
          chunkId: id,
          embed: asyncVec,
          cwd: root,
        })
      ).rejects.toThrow("向量写入失败")

      expect(readFileSync(target, "utf8")).toBe("旧版本\n")
      expect(readdirSync(promoted)).toEqual(["reflection-1.md"])
      expect(repo.countReflectionEntries()).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
