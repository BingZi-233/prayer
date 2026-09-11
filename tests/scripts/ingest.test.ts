import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { chunkText, runIngest } from "@/scripts/ingest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"

vi.mock("@/lib/model/embed", () => ({
  embed: async () => new Float32Array([0.1, 0.2, 0.3]),
}))

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
})
