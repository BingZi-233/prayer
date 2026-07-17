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
