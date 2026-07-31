import { describe, it, expect, beforeEach } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"

let repo: Repo
const vec = () => new Float32Array([1, 0, 0])

beforeEach(() => {
  repo = new Repo(openDb(":memory:", 3))
})

describe("reflection_meta / reflectionEntries", () => {
  it("insertReflectionMeta → reflectionEntries 带出 question/answer,默认 approved", () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "faq甲",
      "human-reflection:qq:100:5",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "100", "问X", "答Y")
    const e = repo.reflectionEntries().find((r) => r.id === id)!
    expect(e).toMatchObject({
      channel: "qq",
      chatId: "100",
      ts: 5,
      question: "问X",
      answer: "答Y",
      status: "approved",
    })
  })

  it("无 meta 的条目 → question/answer 为 null,status 默认 approved", () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "无源",
      "human-reflection:qq:100:5",
      vec()
    )
    expect(repo.reflectionEntries().find((r) => r.id === id)).toMatchObject({
      question: null,
      answer: null,
      status: "approved",
    })
  })

  it("setReflectionStatus 可驳回 / 恢复 / 升格", () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "faq",
      "human-reflection:qq:100:5",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "100", "q", "a")
    expect(repo.setReflectionStatus(id, "rejected")).toBe(true)
    expect(repo.reflectionEntries().find((r) => r.id === id)!.status).toBe(
      "rejected"
    )
    expect(repo.setReflectionStatus(id, "approved")).toBe(true)
    expect(repo.reflectionEntries().find((r) => r.id === id)!.status).toBe(
      "approved"
    )
    expect(repo.setReflectionStatus(id, "promoted")).toBe(true)
    expect(repo.reflectionEntries().find((r) => r.id === id)!.status).toBe(
      "promoted"
    )
  })

  it("migrate 回填:无 meta 的 human-reflection 补 approved 行", () => {
    // 直接插 chunk 不走 insertReflectionMeta,模拟历史整理后条目
    const id = repo.insertKbChunk(
      "human-reflection",
      "旧无 meta",
      "human-reflection:qq:0:1"
    )
    // 读侧无 meta 已视为 approved
    expect(repo.reflectionEntries().find((r) => r.id === id)!.status).toBe(
      "approved"
    )
    // 写侧可补 meta 行
    expect(repo.setReflectionStatus(id, "approved")).toBe(true)
    expect(repo.reflectionEntries().find((r) => r.id === id)!.status).toBe(
      "approved"
    )
  })

  it("replaceReflectionEntries → 删旧 meta(不留孤儿)+ 记 compaction", () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "旧条目",
      "human-reflection:qq:100:1",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "100", "q", "a")
    repo.replaceReflectionEntries(
      [id],
      [{ content: "新条目", embedding: vec() }],
      9_000_000,
      ["旧条目"],
      ["新条目"]
    )
    const entries = repo.reflectionEntries()
    expect(entries).toHaveLength(1)
    // 新条目 chatId=0(全局归属)、无 meta;旧 meta 已随 chunk 删除
    expect(entries[0]).toMatchObject({
      content: "新条目",
      channel: "qq",
      chatId: "0",
      question: null,
      answer: null,
      status: "approved",
    })
    const rc = repo.recentCompactions(5)
    expect(rc).toHaveLength(1)
    expect(rc[0]).toMatchObject({
      ts: 9_000_000,
      beforeCount: 1,
      afterCount: 1,
      before: ["旧条目"],
      after: ["新条目"],
    })
  })

  it("recentCompactions 按 ts 倒序、limit 生效", () => {
    for (const ts of [100, 300, 200]) {
      repo.replaceReflectionEntries([], [], ts, [`b${ts}`], [`a${ts}`])
    }
    const rc = repo.recentCompactions(2)
    expect(rc.map((r) => r.ts)).toEqual([300, 200])
  })
})

describe("整理记录摘要 / 详情分离", () => {
  // 需要直接改库造坏 JSON,单独持有 Database 句柄
  let db: ReturnType<typeof openDb>
  beforeEach(() => {
    db = openDb(":memory:", 3)
    repo = new Repo(db)
  })

  it("recentCompactionSummaries 不带 before/after 全文", () => {
    repo.replaceReflectionEntries([], [], 1_000, ["旧甲", "旧乙"], ["新甲"])
    const rows = repo.recentCompactionSummaries(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      id: rows[0].id,
      ts: 1_000,
      beforeCount: 2,
      afterCount: 1,
    })
    // 摘要行绝不能夹带全文字段(轮询体积失控的根因)
    expect(Object.keys(rows[0]).sort()).toEqual([
      "afterCount",
      "beforeCount",
      "id",
      "ts",
    ])
  })

  it("recentCompactionSummaries 按 ts 倒序、limit 生效", () => {
    for (const ts of [100, 300, 200]) {
      repo.replaceReflectionEntries([], [], ts, [`b${ts}`], [`a${ts}`])
    }
    expect(repo.recentCompactionSummaries(2).map((r) => r.ts)).toEqual([
      300, 200,
    ])
  })

  it("compactionDetail 按 id 取单条全文", () => {
    repo.replaceReflectionEntries([], [], 2_000, ["旧甲", "旧乙"], ["新甲"])
    const id = repo.recentCompactionSummaries(1)[0].id
    expect(repo.compactionDetail(id)).toEqual({
      id,
      ts: 2_000,
      beforeCount: 2,
      afterCount: 1,
      before: ["旧甲", "旧乙"],
      after: ["新甲"],
    })
  })

  it("compactionDetail 查不到返回 null", () => {
    expect(repo.compactionDetail(999999)).toBeNull()
  })

  it("compactionDetail 遇坏 JSON 回退空数组", () => {
    repo.replaceReflectionEntries([], [], 3_000, ["旧"], ["新"])
    const id = repo.recentCompactionSummaries(1)[0].id
    db.prepare(
      "UPDATE reflect_compactions SET before_json = '{坏', after_json = 'null' WHERE id = ?"
    ).run(id)
    expect(repo.compactionDetail(id)).toMatchObject({
      before: [],
      after: [],
    })
  })
})

describe("deleteKbChunk", () => {
  it("三表联动:kb_vec + kb_chunks + reflection_meta 全删", () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "原文",
      "human-reflection:qq:100:5",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "100", "问", "答")
    expect(repo.deleteKbChunk(id)).toBe(true)
    // 反思 list 查不到(LEFT JOIN 没了)
    expect(repo.reflectionEntries().find((e) => e.id === id)).toBeUndefined()
    // 检索也不再命中
    expect(repo.searchKb(vec(), 5).find((h) => h.id === id)).toBeUndefined()
    // meta 行也被清,不留孤儿(直接查表)
    const d = (repo as unknown as { db: import("better-sqlite3").Database }).db
    expect(
      d.prepare("SELECT 1 FROM reflection_meta WHERE chunk_id = ?").get(id)
    ).toBeUndefined()
  })

  it("不存在 id → 返回 false,无副作用", () => {
    expect(repo.deleteKbChunk(99999)).toBe(false)
  })

  it("无 meta 的 chunk 也能删(不报错)", () => {
    const id = repo.insertKbChunk(
      "human-reflection",
      "无meta",
      "human-reflection:qq:0:1"
    )
    expect(repo.deleteKbChunk(id)).toBe(true)
    expect(repo.reflectionEntries()).toHaveLength(0)
  })
})
