import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"

let db: ReturnType<typeof openDb>
let repo: Repo
const vector = () => new Float32Array([1, 0, 0])

beforeEach(() => {
  db = openDb(":memory:", 3)
  repo = new Repo(db)
})
afterEach(() => db.close())

function seedReflection(content = "原有知识") {
  const id = repo.insertKbEntry(
    "human-reflection",
    content,
    "human-reflection:tg:-100:1000",
    vector()
  )
  repo.insertReflectionMeta(id, "tg", "-100", "原问题", "原答案")
  return id
}

/** 表名只来自测试内的固定清单；比较原始行以捕获隐藏字段或向量残留。 */
function snapshot() {
  const tables = [
    "sessions",
    "tickets",
    "config",
    "kb_chunks",
    "reflection_meta",
    "reflect_compactions",
    "group_messages",
    "seen_messages",
    "proactive_replies",
    "question_topics",
    "question_occurrences",
    "usage_daily",
    "tool_stats_daily",
    "resolution_events",
  ]
  return {
    ...Object.fromEntries(
      tables.map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ])
    ),
    vectors: db
      .prepare("SELECT chunk_id, embedding FROM kb_vec ORDER BY chunk_id")
      .all(),
  }
}

describe("跨领域事务", () => {
  it("误返回 Promise 时驱动拒绝提交，并撤销同步阶段的写入", () => {
    const before = snapshot()
    expect(() =>
      repo.transaction(() => {
        repo.sessions.setSessionId("qq:100:1", "不应提交")
        return Promise.resolve("异步结果")
      })
    ).toThrow("Transaction function cannot return a promise")
    expect(snapshot()).toEqual(before)
  })

  it("新领域入口与旧 Repo 方法共享连接，成功后一并提交", () => {
    const result = repo.transaction(() => {
      repo.sessions.setSessionId("qq:100:1", "session-1")
      repo.setHumanMode("qq:100:1", true)
      const ticket = repo.tickets.createTicket("qq:100:1", "需要人工处理")
      const id = repo.knowledge.insertKbEntry(
        "faq.md",
        "知识",
        "faq.md",
        vector()
      )
      repo.reflection.setGroupReflectCursor("tg", "-100", 2000)
      return { ticket, id }
    })
    expect(repo.getTicket(result.ticket)?.sessionKey).toBe("qq:100:1")
    expect(repo.sessions.isHumanMode("qq:100:1")).toBe(true)
    expect(repo.searchKb(vector(), 1)[0].id).toBe(result.id)
    expect(repo.groupReflectCursor("tg", "-100")).toBe(2000)
    expect(db.inTransaction).toBe(false)
  })

  it("后续操作失败时，各领域写入和内部嵌套事务全部回滚", () => {
    repo.setSessionId("qq:100:1", "old-session")
    const before = snapshot()
    expect(() =>
      repo.transaction(() => {
        repo.sessions.setSessionId("qq:100:1", "new-session")
        repo.tickets.createTicket("qq:100:1", "新工单")
        seedReflection()
        repo.messages.bufferGroupMessage(
          "tg",
          "-100",
          "2",
          "member",
          "问题",
          "m1"
        )
        repo.messages.seenMessage("tg:-100:m1")
        repo.proactive.insertProactiveReply("tg", "-100", "2", "问题", "答案")
        repo.proactive.setGroupProactiveCursor("tg", "-100", 1000)
        const topic = repo.topics.insertQuestionTopic("退款", 1000)
        repo.topics.insertQuestionOccurrence(
          topic,
          "tg",
          "-100",
          "2",
          "怎么退款",
          1000
        )
        repo.topics.setTopicCursor("tg", "-100", 1000)
        repo.statistics.insertResolution("handoff", { sessionKey: "qq:100:1" })
        repo.statistics.addToolStatsDaily("2026-09-07", "main", [
          { tool: "kb_search", runs: 1, calls: 1 },
        ])
        repo.config.setConfigRow("transaction-test", "new")
        throw new Error("批次末尾失败")
      })
    ).toThrow("批次末尾失败")
    expect(snapshot()).toEqual(before)
    expect(db.inTransaction).toBe(false)
    // 失败后连接仍可写，不能留在挂起事务中。
    repo.setConfigRow("after-rollback", "ok")
    expect(repo.config.getConfigRow("after-rollback")).toBe("ok")
  })

  it("捕获内层异常只回滚保存点，外层事务仍可继续提交", () => {
    repo.transaction(() => {
      repo.sessions.setSessionId("qq:100:1", "sid")
      try {
        repo.transaction(() => {
          repo.tickets.createTicket("qq:100:1", "应被撤销")
          throw new Error("内层失败")
        })
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
      repo.config.setConfigRow("outer", "committed")
    })
    expect(repo.getSessionId("qq:100:1")).toBe("sid")
    expect(repo.listTickets()).toEqual([])
    expect(repo.getConfigRow("outer")).toBe("committed")
  })

  it("主题归类记录失败时，不留下主题或推进游标", () => {
    repo.setTopicCursor("tg", "-100", 500)
    const before = snapshot()
    db.exec(`CREATE TEMP TRIGGER fail_occurrence BEFORE INSERT ON question_occurrences
      BEGIN SELECT RAISE(ABORT, '归类写入失败'); END`)
    expect(() =>
      repo.transaction(() => {
        const topic = repo.topics.insertQuestionTopic("退款", 1000)
        repo.topics.setTopicCursor("tg", "-100", 1000)
        repo.topics.insertQuestionOccurrence(
          topic,
          "tg",
          "-100",
          "1",
          "问题",
          1000
        )
      })
    ).toThrow("归类写入失败")
    expect(snapshot()).toEqual(before)
  })
})

describe("知识库与反思原子性", () => {
  it("向量维度错误时，不残留已写入的知识分块", () => {
    seedReflection()
    const before = snapshot()
    expect(() =>
      repo.knowledge.insertKbEntry(
        "bad.md",
        "不应保存",
        "bad.md",
        new Float32Array([1, 0])
      )
    ).toThrow()
    expect(snapshot()).toEqual(before)
  })

  it("删除分块的最后一步失败时，恢复正文、向量和反思来源", () => {
    const id = seedReflection()
    const before = snapshot()
    db.exec(`CREATE TEMP TRIGGER fail_meta_delete BEFORE DELETE ON reflection_meta
      BEGIN SELECT RAISE(ABORT, '来源删除失败'); END`)
    expect(() => repo.knowledge.deleteKbChunk(id)).toThrow("来源删除失败")
    expect(snapshot()).toEqual(before)
  })

  it("删除文档正文失败时，恢复此前删除的全部向量", () => {
    repo.insertKbEntry("faq.md", "甲", "faq.md", vector())
    repo.insertKbEntry("faq.md", "乙", "faq.md", vector())
    const before = snapshot()
    db.exec(`CREATE TEMP TRIGGER fail_chunk_delete BEFORE DELETE ON kb_chunks
      BEGIN SELECT RAISE(ABORT, '正文删除失败'); END`)
    expect(() => repo.deleteKbDoc("faq.md")).toThrow("正文删除失败")
    expect(snapshot()).toEqual(before)
  })

  it("整理过程中第二条向量失败时，恢复旧条目并撤销已插入的新条目", () => {
    const id = seedReflection()
    seedReflection("快照外的新知识")
    const before = snapshot()
    expect(() =>
      repo.reflection.replaceReflectionEntries(
        [id],
        [
          { content: "第一条", embedding: vector() },
          { content: "第二条", embedding: new Float32Array([1]) },
        ],
        2000,
        ["原有知识"],
        ["第一条", "第二条"]
      )
    ).toThrow()
    expect(snapshot()).toEqual(before)
  })

  it("整理审计写入失败时，前面的删除与新向量写入也一起回滚", () => {
    const id = seedReflection()
    const before = snapshot()
    db.exec(`CREATE TEMP TRIGGER fail_compaction BEFORE INSERT ON reflect_compactions
      BEGIN SELECT RAISE(ABORT, '整理记录失败'); END`)
    expect(() =>
      repo.replaceReflectionEntries(
        [id],
        [{ content: "整理后", embedding: vector() }],
        2000,
        ["原有知识"],
        ["整理后"]
      )
    ).toThrow("整理记录失败")
    expect(snapshot()).toEqual(before)
  })
})

describe("批量更新原子性", () => {
  it("重置会话纪元失败时，恢复前一步清除的续接指针", () => {
    repo.setSessionId("qq:100:1", "sid-1")
    repo.setSessionId("qq:100:2", "sid-2")
    const before = snapshot()
    db.exec(`CREATE TEMP TRIGGER fail_prior_since BEFORE UPDATE OF prior_since ON sessions
      BEGIN SELECT RAISE(ABORT, '纪元更新失败'); END`)
    expect(() => repo.sessions.clearAllResumeIds()).toThrow("纪元更新失败")
    expect(snapshot()).toEqual(before)
  })

  it("批量工具统计后续行失败时，已累加的旧行也恢复原值", () => {
    repo.addToolStatsDaily("2026-09-07", "main", [
      { tool: "kb_search", runs: 3, calls: 5 },
    ])
    const before = snapshot()
    db.exec(`CREATE TEMP TRIGGER fail_tool_stat BEFORE INSERT ON tool_stats_daily
      WHEN NEW.tool = 'broken' BEGIN SELECT RAISE(ABORT, '统计写入失败'); END`)
    expect(() =>
      repo.statistics.addToolStatsDaily("2026-09-07", "main", [
        { tool: "kb_search", runs: 1, calls: 2 },
        { tool: "broken", runs: 1, calls: 1 },
      ])
    ).toThrow("统计写入失败")
    expect(snapshot()).toEqual(before)
  })
})
