import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { chunkText, runIngest } from "@/scripts/ingest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"

const { embedMock } = vi.hoisted(() => ({
  embedMock: vi.fn(async () => new Float32Array([0.1, 0.2, 0.3])),
}))

vi.mock("@/lib/model/embed", () => ({ embed: embedMock }))

describe("chunkText", () => {
  it("按段落切块,过滤空块", () => {
    const chunks = chunkText("第一段\n\n第二段\n\n\n第三段")
    expect(chunks).toEqual(["第一段", "第二段", "第三段"])
  })
  it("超长段落按上限切分", () => {
    const long = "a".repeat(1200)
    const chunks = chunkText(long, 500)
    expect(chunks.length).toBe(3)
    expect(chunks[0].length).toBe(500)
  })
  it("两行短文仅 1 块(无空行分隔时)", () => {
    expect(chunkText("第一行\n第二行")).toEqual(["第一行\n第二行"])
  })
})

describe("runIngest", () => {
  let dir: string

  beforeEach(() => {
    embedMock.mockReset()
    embedMock.mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]))
  })

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `kb-ingest-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("对给定目录切块入库,返回统计", async () => {
    writeFileSync(join(dir, "a.md"), "hello\n\nworld")
    const repo = new Repo(openDb(":memory:", 3))
    const res = await runIngest(repo, dir)
    expect(res).toEqual([{ file: "a.md", chunks: 2 }])
    expect(repo.kbTotals()).toEqual({ chunks: 2, vecs: 2 })
  })

  it("重复重建不叠加分块(幂等)", async () => {
    writeFileSync(join(dir, "tiny.md"), "两行文本\n而已")
    const repo = new Repo(openDb(":memory:", 3))

    await runIngest(repo, dir)
    await runIngest(repo, dir)
    await runIngest(repo, dir)

    expect(repo.kbDocStats()).toEqual([{ doc: "tiny.md", chunks: 1 }])
    expect(repo.kbTotals()).toEqual({ chunks: 1, vecs: 1 })
    expect(repo.kbChunksByDoc("tiny.md").map((c) => c.content)).toEqual([
      "两行文本\n而已",
    ])
  })

  it("内容变短后旧分块被清掉", async () => {
    writeFileSync(join(dir, "doc.md"), "段一\n\n段二\n\n段三")
    const repo = new Repo(openDb(":memory:", 3))
    await runIngest(repo, dir)
    expect(repo.kbDocStats()[0]?.chunks).toBe(3)

    writeFileSync(join(dir, "doc.md"), "只剩一段")
    await runIngest(repo, dir)
    expect(repo.kbDocStats()).toEqual([{ doc: "doc.md", chunks: 1 }])
    expect(repo.kbChunksByDoc("doc.md")[0]?.content).toBe("只剩一段")
  })

  it("磁盘已删文件的 doc 被 prune,human-reflection 不受影响", async () => {
    writeFileSync(join(dir, "keep.md"), "保留")
    writeFileSync(join(dir, "gone.md"), "待删")
    const repo = new Repo(openDb(":memory:", 3))
    await runIngest(repo, dir)
    // human-reflection 是 DB 专有 doc(反思沉淀),磁盘无文件
    repo.insertKbEntry(
      "human-reflection",
      "反思条目",
      "human-reflection:qq:0:0",
      new Float32Array([0.1, 0.2, 0.3])
    )

    rmSync(join(dir, "gone.md"))
    await runIngest(repo, dir)

    expect(
      repo
        .kbDocStats()
        .map((d) => d.doc)
        .sort()
    ).toEqual(["human-reflection", "keep.md"])
  })

  it("忽略 KB 根内的 symlink 文件", async () => {
    const outside = join(
      tmpdir(),
      `prayer-kb-secret-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
    )
    writeFileSync(outside, "不应入库")
    symlinkSync(outside, join(dir, "leak.md"))
    const repo = new Repo(openDb(":memory:", 3))

    try {
      expect(await runIngest(repo, dir)).toEqual([])
      expect(repo.kbTotals()).toEqual({ chunks: 0, vecs: 0 })
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it("KB 根目录不安全时不误 prune 既有索引", async () => {
    const actual = join(dir, "actual")
    const linked = join(dir, "linked")
    mkdirSync(actual, { recursive: true })
    writeFileSync(join(actual, "active.md"), "当前内容")
    symlinkSync(actual, linked, "dir")
    const repo = new Repo(openDb(":memory:", 3))
    repo.insertKbEntry(
      "old.md",
      "旧索引",
      "old.md",
      new Float32Array([0.1, 0.2, 0.3])
    )

    // 根目录本身是 symlink 时安全边界拒绝所有候选；即使本轮返回空，
    // 也必须保留旧索引，等待运维修复路径后再重建。
    expect(await runIngest(repo, linked)).toEqual([])
    expect(repo.kbDocStats()).toEqual([{ doc: "old.md", chunks: 1 }])
  })

  it("忽略归档目录中的可见 Markdown", async () => {
    const archive = join(dir, "_archive", "old")
    mkdirSync(archive, { recursive: true })
    writeFileSync(join(archive, "old.md"), "历史内容")
    writeFileSync(join(dir, "active.md"), "当前内容")
    const repo = new Repo(openDb(":memory:", 3))

    expect(await runIngest(repo, dir)).toEqual([
      { file: "active.md", chunks: 1 },
    ])
    expect(repo.kbDocStats().map((row) => row.doc)).toEqual(["active.md"])
  })

  it("与另一轮 ingest 共用进程级 KB 锁,不会交错读取/写入", async () => {
    const firstDir = join(dir, "first")
    const secondDir = join(dir, "second")
    mkdirSync(firstDir)
    mkdirSync(secondDir)
    writeFileSync(join(firstDir, "one.md"), "第一轮")
    writeFileSync(join(secondDir, "two.md"), "第二轮")
    const firstRepo = new Repo(openDb(":memory:", 3))
    const secondRepo = new Repo(openDb(":memory:", 3))
    let release!: () => void
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    embedMock.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        started()
        await gate
      }
      return new Float32Array([0.1, 0.2, 0.3])
    })

    const first = runIngest(firstRepo, firstDir)
    await startedPromise
    const second = runIngest(secondRepo, secondDir)
    await Promise.resolve()
    expect(calls).toBe(1)

    release()
    await Promise.all([first, second])
    expect(calls).toBe(2)
    expect(firstRepo.kbDocStats()).toEqual([{ doc: "one.md", chunks: 1 }])
    expect(secondRepo.kbDocStats()).toEqual([{ doc: "two.md", chunks: 1 }])
  })

  it("整轮 embedding 失败时不提交前面文件的部分索引", async () => {
    writeFileSync(join(dir, "first.md"), "第一份")
    writeFileSync(join(dir, "second.md"), "第二份")
    const repo = new Repo(openDb(":memory:", 3))
    repo.insertKbEntry(
      "old.md",
      "旧索引",
      "old.md",
      new Float32Array([0.1, 0.2, 0.3])
    )
    let calls = 0
    embedMock.mockImplementation(async () => {
      calls++
      if (calls === 2) throw new Error("embedding unavailable")
      return new Float32Array([0.1, 0.2, 0.3])
    })

    await expect(runIngest(repo, dir)).rejects.toThrow("embedding unavailable")
    expect(repo.kbDocStats()).toEqual([{ doc: "old.md", chunks: 1 }])
  })
})
