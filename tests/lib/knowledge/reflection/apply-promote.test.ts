import { describe, expect, it, vi } from "vitest"
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
})
