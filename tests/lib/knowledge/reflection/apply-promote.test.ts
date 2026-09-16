import { describe, expect, it, vi } from "vitest"
import {
  existsSync,
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
  type PromoteUnit,
} from "@/lib/knowledge/reflection/apply-promote"
import { MAX_MERGE_CHUNKS } from "@/lib/knowledge/reflection/promote-compose"

const vec = () => new Float32Array([1, 0, 0])
const asyncVec = async () => vec()
const NOW = Date.UTC(2026, 8, 16, 8, 0)
const TARGET = "retrieval/faq/refund.md"
/** 台账/快照文件名里的日期来自 now(),固定住才能断言。 */
const DATE = "2026-09-16"

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

function unit(over: Partial<PromoteUnit> = {}): PromoteUnit {
  return {
    doc: TARGET,
    kind: "new",
    content:
      "# 产品：Packy；协议：任一；任务：退款到账时间\n" +
      "退款 3 天到账。来源：QQ 群客服会话反思 #1；核验日期：2026-09-16；动态性：账期以当前规则为准\n",
    sourceStatus: "QQ 群客服会话反思 #1",
    volatility: "账期以当前规则为准",
    ...over,
  }
}

function fakeFs() {
  const files = new Map<string, string>()
  return {
    files,
    writeFileFn: vi.fn(async (p: string, b: string) => {
      files.set(p, b)
    }),
    mkdirFn: vi.fn(async () => {}),
    writeMetaFn: vi.fn(async (p: string, b: string) => {
      files.set(p, b)
    }),
  }
}

describe("applyPromote", () => {
  it("升格:正式文档入库、原反思 chunk 删除、文件写入 retrieval 层", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()

    const r = await applyPromote({
      repo,
      chunkId: id,
      unit: unit(),
      embed: asyncVec,
      cwd: "/w",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
      writeMetaFn: fs.writeMetaFn,
      now: () => NOW,
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file).toBe(TARGET)
    // 正式文档(doc=rel)入库,检索可命中
    expect(repo.kbDocStats().map((d) => d.doc)).toContain(r.file)
    expect(
      repo.searchBaseKb(vec(), 5).some((h) => h.content.includes("退款"))
    ).toBe(true)
    // 单元无空行 ⇒ 标题行与正文同属一段:与 ingest 用同一个分块器,只出 1 个向量块。
    // (旧格式 `# 升格反思 #1\n\n正文` 是 2 段,计划里这条断言是从旧测试搬来的笔误。)
    expect(repo.kbChunksByDoc(r.file).map((c) => c.content)).toEqual([
      unit().content.trim(),
    ])
    // 原反思条目已删
    expect(repo.countReflectionEntries()).toBe(0)
    // 写在 retrieval/ 下,历史层 promoted/ 不再出现
    expect([...fs.files.keys()]).toContain("/w/docs/kb/retrieval/faq/refund.md")
    expect([...fs.files.keys()].some((k) => k.includes("/promoted/"))).toBe(
      false
    )
  })

  it("二次升格:chunk+meta 已随升格删除,按原语义返回「条目不存在」", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()
    const base = {
      repo,
      chunkId: id,
      unit: unit(),
      embed: asyncVec,
      cwd: "/w",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
      writeMetaFn: fs.writeMetaFn,
      now: () => NOW,
    }
    await applyPromote(base)
    // already 分支只防御「状态=promoted 但 chunk 未删」的历史形态;
    // 正常流程升格即物理删除(deleteKbChunk 级联删 meta),二次升格走「不存在」
    const again = await applyPromote(base)
    expect(again).toEqual({ ok: false, reason: "条目不存在" })
    expect(fs.writeFileFn).toHaveBeenCalledTimes(1)
  })

  it("已升格(历史残留形态):file 留空,不回未必为真的目标路径", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    // 正常流程升格即物理删 chunk,所以这个状态只可能来自历史残留;
    // 此时无从得知当初落到哪个文档,file 必须留空而不是回传入参 unit.doc。
    repo.setReflectionStatus(id, "promoted")
    const fs = fakeFs()

    const r = await applyPromote({
      repo,
      chunkId: id,
      unit: unit(),
      embed: asyncVec,
      cwd: "/w",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
      writeMetaFn: fs.writeMetaFn,
      now: () => NOW,
    })

    expect(r).toEqual({
      ok: true,
      file: "",
      content: expect.any(String),
      already: true,
    })
    expect(fs.writeFileFn).not.toHaveBeenCalled()
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
    let calls = 0
    const embed = vi.fn(async () => {
      calls++
      if (calls === 1) {
        started()
        await firstEmbedding
      }
      return vec()
    })
    const opts = {
      repo,
      chunkId: id,
      unit: unit(),
      embed,
      cwd: "/concurrent",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
      writeMetaFn: fs.writeMetaFn,
      now: () => NOW,
    }

    const first = applyPromote(opts)
    await firstStarted
    const second = applyPromote(opts)
    release()

    expect((await first).ok).toBe(true)
    expect(await second).toEqual({ ok: false, reason: "条目不存在" })
    // 单元是一整段(标题行紧跟正文),共用分块器只切出 1 段。
    expect(embed).toHaveBeenCalledTimes(1)
    expect(fs.writeFileFn).toHaveBeenCalledTimes(1)
  })

  it("embed 失败:DB 完全未动,条目保留可重试,且不留台账", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()

    await expect(
      applyPromote({
        repo,
        chunkId: id,
        unit: unit(),
        embed: () => Promise.reject(new Error("embed 挂了")),
        cwd: "/w",
        writeFileFn: fs.writeFileFn,
        mkdirFn: fs.mkdirFn,
        writeMetaFn: fs.writeMetaFn,
        now: () => NOW,
      })
    ).rejects.toThrow("embed 挂了")

    // 条目仍在,且状态未变
    expect(repo.countReflectionEntries()).toBe(1)
    expect(repo.reflectionEntryDetail(id)?.status).toBe("approved")
    // 正式文档未入库
    expect(repo.kbTotals().chunks).toBe(1)
    // 台账在 embed 之后才写:embed 失败不该留下"已升格"的记录
    expect(fs.writeMetaFn).not.toHaveBeenCalled()
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
        unit: unit(),
        embed: asyncVec,
        cwd: "/w",
        writeFileFn: fs.writeFileFn,
        mkdirFn: fs.mkdirFn,
        writeMetaFn: fs.writeMetaFn,
        now: () => NOW,
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
      unit: unit(),
      embed: asyncVec,
      cwd: "/w",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
      writeMetaFn: fs.writeMetaFn,
      now: () => NOW,
    }
    expect((await applyPromote({ ...opts, chunkId: 999 })).ok).toBe(false)
    const r = await applyPromote({ ...opts, chunkId: id })
    expect(r).toEqual({ ok: false, reason: "已驳回,不可升格" })
    expect(fs.writeFileFn).not.toHaveBeenCalled()
    expect(fs.writeMetaFn).not.toHaveBeenCalled()
  })

  it("单元形状非法:拒绝且不写盘、不写台账", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()

    const r = await applyPromote({
      repo,
      chunkId: id,
      unit: unit({ content: "标题\n\n正文\n" }),
      embed: asyncVec,
      cwd: "/w",
      writeFileFn: fs.writeFileFn,
      mkdirFn: fs.mkdirFn,
      writeMetaFn: fs.writeMetaFn,
      now: () => NOW,
    })

    expect(r.ok).toBe(false)
    expect(fs.writeFileFn).not.toHaveBeenCalled()
    expect(fs.writeMetaFn).not.toHaveBeenCalled()
    expect(repo.countReflectionEntries()).toBe(1)
  })

  it("只注入 writer 时仍执行路径 guard,不触碰默认 mkdir", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const writer = vi.fn(async () => {})

    const r = await applyPromote({
      repo,
      chunkId: id,
      unit: unit(),
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
        unit: unit(),
        embed: asyncVec,
        cwd: root,
        now: () => NOW,
      })

      expect(r.ok).toBe(true)
      const dir = join(root, "docs/kb/retrieval/faq")
      expect(readFileSync(join(dir, "refund.md"), "utf8")).toBe(
        `${unit().content}\n`
      )
      expect(readdirSync(dir)).toEqual(["refund.md"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("merge:读旧正文后追加单元,并先写 pre-edit 快照", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const dir = join(root, "docs/kb/retrieval/faq")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "refund.md"), "旧的正文\n")
      const repo = makeRepo()
      const id = seedReflection(repo)

      const r = await applyPromote({
        repo,
        chunkId: id,
        unit: unit({ kind: "merge" }),
        embed: asyncVec,
        cwd: root,
        now: () => NOW,
      })

      expect(r.ok).toBe(true)
      // 与新建分支同形:整份正文都以 `单元文本 + \n` 结尾
      expect(readFileSync(join(dir, "refund.md"), "utf8")).toBe(
        `旧的正文\n\n${unit().content}\n`
      )
      const meta = readdirSync(join(root, "docs/kb/_meta"))
      expect(meta).toContain(`${DATE}-promote-1-pre-edit.md.disabled`)
      expect(meta).toContain(`${DATE}-promote-1-manifest.md.disabled`)
      expect(
        readFileSync(
          join(root, `docs/kb/_meta/${DATE}-promote-1-pre-edit.md.disabled`),
          "utf8"
        )
      ).toBe("旧的正文\n")
      const manifest = readFileSync(
        join(root, `docs/kb/_meta/${DATE}-promote-1-manifest.md.disabled`),
        "utf8"
      )
      expect(manifest).toContain("- result：committed")
      // 台账里的路径是「相对 docs/kb」,前缀由生成器补:重复前缀会让审计记录指向
      // 不存在的 docs/kb/docs/kb/... ,而这正是台账要防的自相矛盾。
      expect(manifest).toContain("- target：docs/kb/retrieval/faq/refund.md")
      expect(manifest).toContain(
        "- original_path：docs/kb/retrieval/faq/refund.md"
      )
      expect(manifest).toContain(
        "- active_path：docs/kb/retrieval/faq/refund.md"
      )
      expect(manifest).toContain(
        `- pre-edit snapshot：docs/kb/_meta/${DATE}-promote-1-pre-edit.md.disabled`
      )
      expect(manifest).not.toContain("docs/kb/docs/kb")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("崩溃恢复:目标文档已含该单元时重算同一正文,不重复追加", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const dir = join(root, "docs/kb/retrieval/faq")
      mkdirSync(dir, { recursive: true })
      // 复现「rename 成功、DB 事务未提交」的崩溃残局:磁盘已是 P0+单元,
      // 台账 committed,但反思条目仍 approved(所以下一轮会自动重试)。
      writeFileSync(join(dir, "refund.md"), `旧的正文\n\n${unit().content}\n`)
      const repo = makeRepo()
      const id = seedReflection(repo)

      const r = await applyPromote({
        repo,
        chunkId: id,
        unit: unit({ kind: "merge" }),
        embed: asyncVec,
        cwd: root,
        now: () => NOW,
      })

      expect(r.ok).toBe(true)
      // 关键:不再追加第二次,正文与崩溃前完全一致
      expect(readFileSync(join(dir, "refund.md"), "utf8")).toBe(
        `旧的正文\n\n${unit().content}\n`
      )
      // 并且这次把 DB 那一步补做掉:索引重建、反思条目删除
      expect(repo.countReflectionEntries()).toBe(0)
      expect(
        repo.kbChunksByDoc("retrieval/faq/refund.md").length
      ).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("崩溃恢复(边界):残局恰为 MAX_MERGE_CHUNKS+1 段时去重仍收敛", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const dir = join(root, "docs/kb/retrieval/faq")
      mkdirSync(dir, { recursive: true })
      // 首次 merge 时 P0 恰为 MAX_MERGE_CHUNKS 段(不 > 上限,放行),崩溃后残局
      // 多一段。若尺寸闸门排在去重之前,重试会一直撞「目标文档过大」而永不收敛:
      // 文件 41 段、索引 40 段持续分叉,条目永远 approved、每轮白烧两次 LLM 调用。
      const old = Array.from(
        { length: MAX_MERGE_CHUNKS },
        (_, i) => `旧段${i}`
      ).join("\n\n")
      writeFileSync(join(dir, "refund.md"), `${old}\n\n${unit().content}\n`)
      const repo = makeRepo()
      const id = seedReflection(repo)

      const r = await applyPromote({
        repo,
        chunkId: id,
        unit: unit({ kind: "merge" }),
        embed: asyncVec,
        cwd: root,
        now: () => NOW,
      })

      expect(r.ok).toBe(true)
      expect(repo.countReflectionEntries()).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("merge 目标不存在:失败且不新建", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      mkdirSync(join(root, "docs/kb/retrieval/faq"), { recursive: true })
      const repo = makeRepo()
      const id = seedReflection(repo)

      const r = await applyPromote({
        repo,
        chunkId: id,
        unit: unit({ kind: "merge" }),
        embed: asyncVec,
        cwd: root,
        now: () => NOW,
      })

      expect(r).toEqual({ ok: false, reason: "目标文档不存在" })
      expect(existsSync(join(root, "docs/kb/retrieval/faq/refund.md"))).toBe(
        false
      )
      expect(repo.countReflectionEntries()).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("new 目标已存在:拒绝覆盖既有 canonical 文档", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const dir = join(root, "docs/kb/retrieval/faq")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "refund.md"), "别人的 canonical 文档\n")
      const repo = makeRepo()
      const id = seedReflection(repo)

      const r = await applyPromote({
        repo,
        chunkId: id,
        unit: unit({ kind: "new" }),
        embed: asyncVec,
        cwd: root,
        now: () => NOW,
      })

      expect(r).toEqual({ ok: false, reason: "目标文档已存在" })
      expect(readFileSync(join(dir, "refund.md"), "utf8")).toBe(
        "别人的 canonical 文档\n"
      )
      expect(repo.countReflectionEntries()).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("merge 到超段文档:拒绝合并", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const dir = join(root, "docs/kb/retrieval/faq")
      mkdirSync(dir, { recursive: true })
      // 段数超过 MAX_MERGE_CHUNKS
      writeFileSync(
        join(dir, "refund.md"),
        "段\n\n".repeat(MAX_MERGE_CHUNKS + 1)
      )
      const repo = makeRepo()
      const id = seedReflection(repo)

      const r = await applyPromote({
        repo,
        chunkId: id,
        unit: unit({ kind: "merge" }),
        embed: asyncVec,
        cwd: root,
        now: () => NOW,
      })

      expect(r).toEqual({ ok: false, reason: "目标文档过大,拒绝合并" })
      expect(repo.countReflectionEntries()).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("台账先于活跃语料:台账写失败则不写正文", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()
    fs.writeMetaFn.mockRejectedValue(new Error("磁盘满了"))

    await expect(
      applyPromote({
        repo,
        chunkId: id,
        unit: unit(),
        embed: asyncVec,
        cwd: "/w",
        writeFileFn: fs.writeFileFn,
        mkdirFn: fs.mkdirFn,
        writeMetaFn: fs.writeMetaFn,
        now: () => NOW,
      })
    ).rejects.toThrow("磁盘满了")

    expect(fs.writeFileFn).not.toHaveBeenCalled()
    expect(repo.countReflectionEntries()).toBe(1)
  })

  it("正文写盘失败:台账改写成 rolled_back,不停在 committed", async () => {
    const repo = makeRepo()
    const id = seedReflection(repo)
    const fs = fakeFs()
    fs.writeFileFn.mockRejectedValue(new Error("磁盘满了"))

    await expect(
      applyPromote({
        repo,
        chunkId: id,
        unit: unit(),
        embed: asyncVec,
        cwd: "/w",
        writeFileFn: fs.writeFileFn,
        mkdirFn: fs.mkdirFn,
        writeMetaFn: fs.writeMetaFn,
        now: () => NOW,
      })
    ).rejects.toThrow("磁盘满了")

    // 台账先于正文落盘,所以正文失败时台账已经写成 committed;
    // 不改写就等于留下一条指向从未落盘内容的"成功"记录。
    const manifest = [...fs.files.entries()].find(([p]) =>
      p.endsWith(`${DATE}-promote-1-manifest.md.disabled`)
    )?.[1]
    expect(manifest).toBeDefined()
    expect(manifest).toContain("- result：rolled_back")
    expect(manifest).not.toContain("- result：committed")
    expect(repo.countReflectionEntries()).toBe(1)
  })

  it("embed 失败:保留现有正式文件且不留临时文件", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const dir = join(root, "docs/kb/retrieval/faq")
      mkdirSync(dir, { recursive: true })
      const target = join(dir, "refund.md")
      writeFileSync(target, "旧版本\n")
      const repo = makeRepo()
      const id = seedReflection(repo)

      await expect(
        applyPromote({
          repo,
          chunkId: id,
          unit: unit({ kind: "merge" }),
          embed: () => Promise.reject(new Error("embed 挂了")),
          cwd: root,
          now: () => NOW,
        })
      ).rejects.toThrow("embed 挂了")

      expect(readFileSync(target, "utf8")).toBe("旧版本\n")
      expect(readdirSync(dir)).toEqual(["refund.md"])
      expect(repo.countReflectionEntries()).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("DB 失败:恢复现有正式文件、清理临时文件、台账标 rolled_back", async () => {
    const root = mkdtempSync(join(tmpdir(), "prayer-promote-"))
    try {
      const dir = join(root, "docs/kb/retrieval/faq")
      mkdirSync(dir, { recursive: true })
      const target = join(dir, "refund.md")
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
          unit: unit({ kind: "merge" }),
          embed: asyncVec,
          cwd: root,
          now: () => NOW,
        })
      ).rejects.toThrow("向量写入失败")

      expect(readFileSync(target, "utf8")).toBe("旧版本\n")
      expect(readdirSync(dir)).toEqual(["refund.md"])
      expect(repo.countReflectionEntries()).toBe(1)
      expect(
        readFileSync(
          join(root, `docs/kb/_meta/${DATE}-promote-1-manifest.md.disabled`),
          "utf8"
        )
      ).toContain("- result：rolled_back")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
