import { describe, it, expect, beforeEach } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { KB_SEARCH_SQL, kbSearchSql } from "@/lib/core/db/kb-sql"

let db: ReturnType<typeof openDb>
let repo: Repo
const vec = () => new Float32Array([1, 0, 0])

function addPending(content = "待审条目") {
  return repo.insertReflectionEntry(
    "human-reflection",
    content,
    "human-reflection:qq:100:5",
    vec(),
    { channel: "qq", chatId: "100", question: "q", answer: "a" }
  )
}

beforeEach(() => {
  db = openDb(":memory:", 3)
  repo = new Repo(db)
})

describe("反思默认待审", () => {
  it("insertReflectionEntry 落 pending,带 meta", () => {
    const id = addPending()
    expect(repo.reflectionEntryDetail(id)).toMatchObject({
      status: "pending",
      question: "q",
      answer: "a",
      chatId: "100",
    })
  })

  it("searchKb 默认不命中 pending,includePending 命中", () => {
    addPending("待审条目")
    expect(repo.searchKb(vec(), 10)).toHaveLength(0)
    expect(
      repo.searchKb(vec(), 10, { includePending: true }).map((h) => h.content)
    ).toEqual(["待审条目"])
  })

  it("approve 后可检索", () => {
    const id = addPending()
    repo.setReflectionStatus(id, "approved")
    expect(repo.searchKb(vec(), 10)).toHaveLength(1)
  })

  it("kbSearchSql:KB_SEARCH_SQL 即 includePending=false 变体", () => {
    expect(KB_SEARCH_SQL).toBe(kbSearchSql({ includePending: false }))
    expect(kbSearchSql({ includePending: true })).not.toContain("'pending'")
    expect(KB_SEARCH_SQL).toContain("'pending'")
  })

  it("原子落库:向量写入失败时不留孤儿 chunk / meta", () => {
    expect(() =>
      repo.insertReflectionEntry(
        "human-reflection",
        "坏向量",
        "human-reflection:qq:100:5",
        new Float32Array([1, 0]), // 维度不符 → kb_vec 插入失败
        { channel: "qq", chatId: "100", question: "q", answer: "a" }
      )
    ).toThrow()
    expect(repo.kbTotals()).toEqual({ chunks: 0, vecs: 0 })
    expect(db.prepare("SELECT COUNT(*) n FROM reflection_meta").get()).toEqual({
      n: 0,
    })
  })

  it("promoteReflection 拒绝 pending", () => {
    const id = addPending()
    expect(repo.promoteReflection(id).ok).toBe(false)
    repo.setReflectionStatus(id, "approved")
    expect(repo.promoteReflection(id).ok).toBe(true)
  })

  it("countReflectionsByStatus 与 status 过滤", () => {
    const a = addPending("甲")
    addPending("乙")
    const c = addPending("丙")
    repo.setReflectionStatus(a, "approved")
    repo.setReflectionStatus(c, "rejected")
    // 无 meta 的旧条目视为 approved
    repo.insertKbEntry(
      "human-reflection",
      "旧",
      "human-reflection:qq:1:1",
      vec()
    )
    expect(repo.countReflectionsByStatus()).toEqual({
      pending: 1,
      approved: 2,
      rejected: 1,
      promoted: 0,
    })
    const pend = repo.reflectionEntrySummaries(300, 200, 500, "pending")
    expect(pend.map((e) => e.content)).toEqual(["乙"])
    expect(
      repo.reflectionEntrySummaries(300, 200, 500, "approved")
    ).toHaveLength(2)
    expect(repo.reflectionEntrySummaries(300, 200, 500)).toHaveLength(4)
  })
})
