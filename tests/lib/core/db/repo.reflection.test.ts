import { describe, it, expect, beforeEach } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"

let repo: Repo
const vec = () => new Float32Array([1, 0, 0])

/** reflect_compactions 现在只记一次性拆分审计;直接读表断言(仓储已无读取方法)。 */
function auditRows(): {
  ts: number
  before_count: number
  after_count: number
  before_json: string
  after_json: string
}[] {
  const db = (repo as unknown as { db: import("better-sqlite3").Database }).db
  return db
    .prepare(
      "SELECT ts, before_count, after_count, before_json, after_json FROM reflect_compactions ORDER BY ts DESC"
    )
    .all() as ReturnType<typeof auditRows>
}

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

  it("replaceReflectionEntries → 删旧 meta(不留孤儿)+ 写拆分审计", () => {
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
    const rc = auditRows()
    expect(rc).toHaveLength(1)
    expect(rc[0]).toMatchObject({
      ts: 9_000_000,
      before_count: 1,
      after_count: 1,
    })
    expect(JSON.parse(rc[0].before_json)).toEqual(["旧条目"])
    expect(JSON.parse(rc[0].after_json)).toEqual(["新条目"])
  })

  it("replaceReflectionEntries 空条目 → 只删旧块与 meta,审计 after 为空数组", () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "旧碎片",
      "human-reflection:qq:0:1",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "0", "q", "完整 FAQ")
    expect(
      repo.replaceReflectionEntries(
        [id],
        [],
        9_000_000,
        [{ id, content: "旧碎片", faq: "完整 FAQ" }],
        [],
        { expectedStatus: "approved", reviewState: "legacy" }
      )
    ).toBe(true)
    expect(repo.reflectionEntries()).toHaveLength(0)
    const db = (repo as unknown as { db: import("better-sqlite3").Database }).db
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM reflection_meta").get()
    ).toEqual({ n: 0 })
    expect(db.prepare("SELECT COUNT(*) AS n FROM kb_vec").get()).toEqual({
      n: 0,
    })
    const rc = auditRows()
    expect(rc).toHaveLength(1)
    expect(rc[0]).toMatchObject({ before_count: 1, after_count: 0 })
    expect(JSON.parse(rc[0].after_json)).toEqual([])
  })

  it("替换切块与完整 FAQ 元数据同事务写入,后续可恢复完整上下文", () => {
    const faq = "问:如何操作?\n答:先配置,再校验;失败时回退,保留所有步骤与例外。"
    expect(
      repo.replaceReflectionEntries(
        [],
        [
          { content: "问:如何操作?", faq, embedding: vec() },
          { content: "答:先配置,再校验", faq, embedding: vec() },
        ],
        123,
        [],
        [faq]
      )
    ).toBe(true)
    expect(repo.reflectionEntries()).toHaveLength(2)
    for (const entry of repo.reflectionEntries()) {
      expect(entry).toMatchObject({
        chatId: "0",
        question: null,
        answer: faq,
        status: "approved",
      })
    }
  })

  it("替换事务向量写入失败时回滚 chunk、元数据与审计记录", () => {
    expect(() =>
      repo.replaceReflectionEntries(
        [],
        [
          { content: "第一块", faq: "完整 FAQ", embedding: vec() },
          {
            content: "第二块",
            faq: "完整 FAQ",
            embedding: new Float32Array([1, 0]),
          },
        ],
        123,
        [],
        ["完整 FAQ"]
      )
    ).toThrow()
    expect(repo.reflectionEntries()).toHaveLength(0)
    expect(auditRows()).toHaveLength(0)
    const db = (repo as unknown as { db: import("better-sqlite3").Database }).db
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM reflection_meta").get()
    ).toEqual({ n: 0 })
  })

  it("reviewState 写入新块 meta(拆分产物标 legacy)", () => {
    expect(
      repo.replaceReflectionEntries(
        [],
        [
          { content: "带摘录", faq: "摘录", embedding: vec() },
          { content: "无摘录", embedding: vec() },
        ],
        123,
        [],
        ["带摘录", "无摘录"],
        { reviewState: "legacy" }
      )
    ).toBe(true)
    const byContent = new Map(
      repo.reflectionEntries().map((e) => [e.content, e])
    )
    expect(byContent.get("带摘录")).toMatchObject({
      answer: "摘录",
      reviewState: "legacy",
    })
    // 指定 reviewState 时即使没有 faq 也要写 meta,否则账本状态丢失
    expect(byContent.get("无摘录")).toMatchObject({
      answer: null,
      reviewState: "legacy",
    })
  })

  describe("expectedStatus 乐观校验", () => {
    const seedOld = () =>
      ["旧甲", "旧乙"].map((c) => {
        const id = repo.insertKbEntry(
          "human-reflection",
          c,
          "human-reflection:qq:0:1",
          vec()
        )
        repo.insertReflectionMeta(id, "qq", "0", "q", "完整")
        return id
      })
    const replace = (ids: number[]) =>
      repo.replaceReflectionEntries(
        ids,
        [{ content: "新", faq: "摘录", embedding: vec() }],
        99,
        ["旧甲", "旧乙"],
        ["新"],
        { expectedStatus: "approved", reviewState: "legacy" }
      )

    it("旧块有一个已被驳回 → 返回 false,不删不插不写审计", () => {
      const ids = seedOld()
      repo.setReflectionStatus(ids[1], "rejected")
      expect(replace(ids)).toBe(false)
      expect(
        repo
          .reflectionEntries()
          .map((e) => e.content)
          .sort()
      ).toEqual(["旧乙", "旧甲"].sort())
      expect(auditRows()).toHaveLength(0)
    })

    it("旧块有一个已被删除 → 返回 false", () => {
      const ids = seedOld()
      repo.deleteKbChunk(ids[0])
      expect(replace(ids)).toBe(false)
      expect(repo.reflectionEntries().map((e) => e.content)).toEqual(["旧乙"])
      expect(auditRows()).toHaveLength(0)
    })

    it("precondition 返回 false → 拒绝替换", () => {
      const ids = seedOld()
      expect(
        repo.replaceReflectionEntries(
          ids,
          [{ content: "新", embedding: vec() }],
          99,
          [],
          [],
          { precondition: () => false }
        )
      ).toBe(false)
      expect(repo.reflectionEntries()).toHaveLength(2)
      expect(auditRows()).toHaveLength(0)
    })

    it("审计列可承载对象数组", () => {
      const ids = seedOld()
      repo.replaceReflectionEntries(
        ids,
        [{ content: "新", faq: "摘录", embedding: vec() }],
        99,
        [
          { id: ids[0], content: "旧甲", faq: "完整" },
          { id: ids[1], content: "旧乙" },
        ],
        [{ text: "新", answer: "摘录" }]
      )
      const [row] = auditRows()
      expect(row.before_count).toBe(2)
      expect(row.after_count).toBe(1)
      expect(JSON.parse(row.before_json)[0]).toEqual({
        id: ids[0],
        content: "旧甲",
        faq: "完整",
      })
      expect(JSON.parse(row.after_json)).toEqual([
        { text: "新", answer: "摘录" },
      ])
    })

    it("全部仍为 approved → 替换并写审计", () => {
      const ids = seedOld()
      expect(replace(ids)).toBe(true)
      expect(repo.reflectionEntries().map((e) => e.content)).toEqual(["新"])
      expect(auditRows()).toHaveLength(1)
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

describe("升格评审账本", () => {
  const seed = (source = "human-reflection:qq:100:5") => {
    const id = repo.insertKbEntry("human-reflection", "faq", source, vec())
    repo.insertReflectionMeta(id, "qq", "100", "问", "答")
    return id
  }
  const entry = (id: number) =>
    repo.reflectionEntries().find((r) => r.id === id)!
  let db: ReturnType<typeof openDb>
  beforeEach(() => {
    db = openDb(":memory:", 3)
    repo = new Repo(db)
  })

  it("新反思默认未评审", () => {
    const e = entry(seed())
    expect(e.reviewState).toBeNull()
    expect(e.reviewAttempts).toBe(0)
    expect(e.reviewNote).toBeNull()
  })

  it("摘要与详情同样带账本字段", () => {
    const id = seed()
    repo.setReviewState(id, "declined", "无复用价值")
    expect(
      repo.reflectionEntrySummaries().find((r) => r.id === id)
    ).toMatchObject({ reviewState: "declined", reviewNote: "无复用价值" })
    expect(repo.reflectionEntryDetail(id)).toMatchObject({
      reviewState: "declined",
    })
  })

  it("可重现失败计次,达上限转 failed;不计次只写 note", () => {
    const id = seed()
    repo.recordPromoteFailure(id, "超时", false, 3)
    expect(entry(id)).toMatchObject({
      reviewAttempts: 0,
      reviewState: null,
      reviewNote: "超时",
    })
    repo.recordPromoteFailure(id, "x", true, 3)
    repo.recordPromoteFailure(id, "x", true, 3)
    expect(entry(id).reviewState).toBeNull()
    repo.recordPromoteFailure(id, "单元超长(612 > 500)", true, 3)
    expect(entry(id)).toMatchObject({
      reviewState: "failed",
      reviewAttempts: 3,
      reviewNote: "单元超长(612 > 500)",
    })
  })

  it("恢复入库清空账本;legacy 保持 legacy", () => {
    const id = seed()
    repo.recordPromoteFailure(id, "x", true, 1)
    repo.setReflectionStatus(id, "rejected")
    expect(entry(id).reviewState).toBe("failed")
    repo.setReflectionStatus(id, "approved")
    expect(entry(id)).toMatchObject({
      status: "approved",
      reviewState: null,
      reviewAttempts: 0,
      reviewNote: null,
    })

    const legacy = seed("human-reflection:qq:0:9")
    repo.setReviewState(legacy, "legacy", "存量")
    repo.recordPromoteFailure(legacy, "存量", true, 3)
    repo.setReflectionStatus(legacy, "approved")
    expect(entry(legacy)).toMatchObject({
      reviewState: "legacy",
      reviewAttempts: 1,
      reviewNote: "存量",
    })
  })

  it("不计次调用不会改变状态,即使 attempts 已达上限", () => {
    const id = seed()
    repo.recordPromoteFailure(id, "a", true, 3)
    repo.recordPromoteFailure(id, "a", true, 3)
    repo.recordPromoteFailure(id, "a", true, 3)
    repo.setReviewState(id, "accepted")
    repo.recordPromoteFailure(id, "超时", false, 3)
    expect(entry(id)).toMatchObject({
      reviewState: "accepted",
      reviewAttempts: 3,
      reviewNote: "超时",
    })
  })

  it("对不存在的 chunk 记账不会造孤儿 meta", () => {
    repo.setReviewState(99999, "declined", "n")
    repo.recordPromoteFailure(99999, "n", true, 3)
    expect(repo.reflectionEntries()).toHaveLength(0)
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM reflection_meta").get() as {
          n: number
        }
      ).n
    ).toBe(0)
  })
})
