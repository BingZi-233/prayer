import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb, migrateLegacySessionKeys } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import BetterSqlite3 from "better-sqlite3"
import type Database from "better-sqlite3"

let db: Database.Database
let repo: Repo

beforeEach(() => {
  db = openDb(":memory:", 3)
  repo = new Repo(db)
})

describe("Repo sessions", () => {
  it("upsert 后能读回 session_id", () => {
    repo.setSessionId("g:u", "sid-1")
    expect(repo.getSessionId("g:u")).toBe("sid-1")
  })

  it("setSessionId 同步写 session_id 与 resume_id;clearResumeId 只清续接、保留展示", () => {
    repo.setSessionId("g:u", "sid-1")
    expect(repo.getResumeId("g:u")).toBe("sid-1")
    repo.clearResumeId("g:u")
    expect(repo.getResumeId("g:u")).toBeUndefined() // 续接指针清空
    expect(repo.getSessionId("g:u")).toBe("sid-1") // 展示指针保留
  })

  it("clearAllResumeIds 清所有续接、保留展示,返回受影响数", () => {
    repo.setSessionId("g:u1", "sid-1")
    repo.setSessionId("g:u2", "sid-2")
    repo.clearResumeId("g:u2") // u2 已无 resume_id → 不计入
    const n = repo.clearAllResumeIds()
    expect(n).toBe(1) // 仅 u1 此前仍有 resume_id
    expect(repo.getResumeId("g:u1")).toBeUndefined()
    expect(repo.getResumeId("g:u2")).toBeUndefined()
    expect(repo.getSessionId("g:u1")).toBe("sid-1") // 展示指针保留
    expect(repo.getSessionId("g:u2")).toBe("sid-2")
  })

  it("listSessions 返回 humanSince/lastQuestion", () => {
    repo.setSessionId("g:u", "sid-1")
    db.prepare(
      "UPDATE sessions SET human_mode=1, human_since=1700, last_question='退款吗' WHERE key='g:u'"
    ).run()
    const s = repo.listSessions()[0]
    expect(s.humanMode).toBe(true)
    expect(s.humanSince).toBe(1700)
    expect(s.lastQuestion).toBe("退款吗")
  })

  it("listSessions.active 反映 resume_id 是否存在", () => {
    repo.setSessionId("g:a", "sid-a")
    repo.setSessionId("g:b", "sid-b")
    repo.clearResumeId("g:b")
    const byKey = Object.fromEntries(
      repo.listSessions().map((s) => [s.key, s.active])
    )
    expect(byKey["g:a"]).toBe(true)
    expect(byKey["g:b"]).toBe(false)
  })
})

describe("Repo dedupe", () => {
  it("seenMessage 首次 false,再次 true", () => {
    expect(repo.seenMessage("qq:100:1001")).toBe(false)
    expect(repo.seenMessage("qq:100:1001")).toBe(true)
  })
})

describe("Repo kb", () => {
  it("插入 chunk + 向量,可按向量近邻检索", () => {
    const id = repo.insertKbChunk("faq.md", "退货政策 7 天", "faq")
    repo.insertKbVec(id, new Float32Array([1, 0, 0]))
    const id2 = repo.insertKbChunk("faq.md", "无关内容", "faq")
    repo.insertKbVec(id2, new Float32Array([0, 1, 0]))
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 1)
    expect(hits[0].content).toContain("退货")
  })

  it("searchKb 排除 status=rejected 的反思条目,基础文档与 approved 仍命中", () => {
    const base = repo.insertKbEntry(
      "faq/x.md",
      "基础文档",
      "faq/x.md",
      new Float32Array([1, 0, 0])
    )
    const ok = repo.insertKbEntry(
      "human-reflection",
      "已入库反思",
      "human-reflection:qq:1:1",
      new Float32Array([1, 0, 0])
    )
    repo.insertReflectionMeta(ok, "qq", "1", "q", "a")
    const bad = repo.insertKbEntry(
      "human-reflection",
      "已驳回反思",
      "human-reflection:qq:1:2",
      new Float32Array([1, 0, 0])
    )
    repo.insertReflectionMeta(bad, "qq", "1", "q2", "a2")
    repo.setReflectionStatus(bad, "rejected")
    const promo = repo.insertKbEntry(
      "human-reflection",
      "已升格反思",
      "human-reflection:qq:1:3",
      new Float32Array([1, 0, 0])
    )
    repo.insertReflectionMeta(promo, "qq", "1", "q3", "a3")
    repo.setReflectionStatus(promo, "promoted")
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 10)
    const contents = hits.map((h) => h.content)
    expect(contents).toContain("基础文档")
    expect(contents).toContain("已入库反思")
    expect(contents).not.toContain("已驳回反思")
    expect(contents).not.toContain("已升格反思")
    expect(hits.some((h) => h.id === base)).toBe(true)
    expect(hits.some((h) => h.id === ok)).toBe(true)
    expect(hits.some((h) => h.id === bad)).toBe(false)
    expect(hits.some((h) => h.id === promo)).toBe(false)
  })

  it("kbTotals / kbDocStats / kbChunksByDoc 供向量库预览", () => {
    const a = repo.insertKbChunk("faq/退款.md", "退款要 7 天", "faq/退款.md")
    repo.insertKbVec(a, new Float32Array([1, 0, 0]))
    const b = repo.insertKbChunk("faq/退款.md", "整单退", "faq/退款.md")
    repo.insertKbVec(b, new Float32Array([0, 1, 0]))
    repo.insertKbChunk("intro.md", "简介", "intro.md") // 只 chunk 无向量

    expect(repo.kbTotals()).toEqual({ chunks: 3, vecs: 2 })
    expect(repo.kbDocStats()).toEqual([
      { doc: "faq/退款.md", chunks: 2 },
      { doc: "intro.md", chunks: 1 },
    ])
    const chunks = repo.kbChunksByDoc("faq/退款.md")
    expect(chunks.map((c) => c.content)).toEqual(["退款要 7 天", "整单退"])
    expect(chunks[0].id).toBe(a)
  })
})

describe("Repo tickets", () => {
  it("listTickets 含 open 与 closed,按创建时间降序", () => {
    const a = repo.createTicket("g:1", "问题A")
    const b = repo.createTicket("g:2", "问题B")
    db.prepare("UPDATE tickets SET status='closed', created_at=? WHERE id=?").run(
      1000,
      a
    )
    db.prepare("UPDATE tickets SET created_at=? WHERE id=?").run(2000, b)
    const list = repo.listTickets()
    expect(list.length).toBe(2)
    expect(list.map((t) => t.status).sort()).toEqual(["closed", "open"])
    expect(list.find((t) => t.id === b)!.status).toBe("open")
    expect(list[0].id).toBe(b) // 降序:后创建的(created_at 更大)排首
    expect(list[1].id).toBe(a)
  })
})

describe("Repo group_messages buffer", () => {
  it("落库后能按窗口升序取回,并按 limit 截最近", () => {
    repo.bufferGroupMessage("qq", "100", "200", "member", "问题一")
    repo.bufferGroupMessage("qq", "100", "201", "admin", "回答一")
    repo.bufferGroupMessage("qq", "999", "300", "member", "别的群") // 不同群
    const win = repo.groupMessageWindow("qq", "100", 0, 10)
    expect(win.map((m) => m.text)).toEqual(["问题一", "回答一"])
    expect(win[1].senderRole).toBe("admin")
    expect(win[1].userId).toBe("201")
  })

  it("groupsWithAdminMessagesUpTo 返 until 前有管理发言的群;hasAdminMessageBetween 判 band 内", () => {
    const now = Date.now()
    db.prepare(
      "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
    ).run("qq", "100", "201", "admin", "客服", now - 100)
    db.prepare(
      "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
    ).run("qq", "101", "202", "member", "用户", now - 100) // 非管理
    expect(repo.groupsWithAdminMessagesUpTo(now)).toEqual([
      { channel: "qq", chatId: "100" },
    ])
    expect(repo.groupsWithAdminMessagesUpTo(now - 1000)).toEqual([]) // 太新未达上界
    expect(repo.hasAdminMessageBetween("qq", "100", now - 1000, now)).toBe(true)
    expect(repo.hasAdminMessageBetween("qq", "100", now - 50, now)).toBe(false) // band 内无
    expect(repo.hasAdminMessageBetween("qq", "101", now - 1000, now)).toBe(
      false
    ) // 非管理
  })

  it("pruneGroupMessages 删早于截止的行", () => {
    const now = Date.now()
    db.prepare(
      "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
    ).run("qq", "100", "200", "member", "旧", now - 10000)
    repo.bufferGroupMessage("qq", "100", "200", "member", "新")
    repo.pruneGroupMessages(now - 5000)
    expect(
      repo.groupMessageWindow("qq", "100", 0, 10).map((m) => m.text)
    ).toEqual(["新"])
  })

  it("bufferGroupMessage:同 messageId 重复投递只落一行(双进程/WS 重推防御)", () => {
    repo.bufferGroupMessage("qq", "100", "200", "member", "同一条", "9001")
    repo.bufferGroupMessage("qq", "100", "200", "member", "同一条", "9001") // 第二实例重复投递
    const dup = db
      .prepare(
        "SELECT COUNT(*) AS c FROM group_messages WHERE message_id = '9001'"
      )
      .get() as { c: number }
    expect(dup.c).toBe(1)
    // 无 messageId(NULL)不受唯一约束限制:SQLite UNIQUE 允许多个 NULL
    repo.bufferGroupMessage("qq", "100", "200", "member", "无 id")
    repo.bufferGroupMessage("qq", "100", "200", "member", "无 id")
    const nulls = db
      .prepare(
        "SELECT COUNT(*) AS c FROM group_messages WHERE message_id IS NULL AND text = '无 id'"
      )
      .get() as { c: number }
    expect(nulls.c).toBe(2)
  })

  it("groupReflectCursor 缺省 0,按群独立读写 round-trip", () => {
    expect(repo.groupReflectCursor("qq", "100")).toBe(0)
    repo.setGroupReflectCursor("qq", "100", 123456)
    expect(repo.groupReflectCursor("qq", "100")).toBe(123456)
    expect(repo.groupReflectCursor("qq", "200")).toBe(0) // 群隔离
  })
})

describe("group_messages 迁移去重", () => {
  it("旧库已有 message_id 重复行:迁移删重(留最早)后建唯一索引;NULL 行不动", () => {
    const dir = mkdtempSync(join(tmpdir(), "prayer-migrate-"))
    const p = join(dir, "old.db")
    // 手工造「加了 message_id 列、尚无唯一索引」的旧库,模拟双进程双写后的脏数据
    const raw = new BetterSqlite3(p)
    raw.exec(`CREATE TABLE group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      sender_role TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
      message_id INTEGER
    )`)
    const ins = raw.prepare(
      "INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at,message_id) VALUES (?,?,?,?,?,?)"
    )
    ins.run(100, 200, "member", "重复", 1000, 42)
    ins.run(100, 200, "member", "重复", 1010, 42) // 第二进程晚几 ms 的那份
    ins.run(100, 200, "member", "无id-1", 1020, null)
    ins.run(100, 200, "member", "无id-2", 1030, null)
    raw.close()

    const migrated = openDb(p, 3)
    const kept = migrated
      .prepare(
        "SELECT created_at FROM group_messages WHERE message_id = '42'"
      )
      .all() as { created_at: number }[]
    expect(kept).toEqual([{ created_at: 1000 }]) // 只留最早一份
    const nulls = migrated
      .prepare(
        "SELECT COUNT(*) AS c FROM group_messages WHERE message_id IS NULL"
      )
      .get() as { c: number }
    expect(nulls.c).toBe(2)
    // 唯一索引已建:再次重复插入被 OR IGNORE 吞掉
    new Repo(migrated).bufferGroupMessage(
      "qq",
      "100",
      "200",
      "member",
      "重复",
      "42"
    )
    const still = migrated
      .prepare(
        "SELECT COUNT(*) AS c FROM group_messages WHERE message_id = '42'"
      )
      .get() as { c: number }
    expect(still.c).toBe(1)
    // channel 列已存在且旧 id 转 TEXT
    const row = migrated
      .prepare(
        "SELECT channel, group_id, user_id FROM group_messages WHERE message_id = '42'"
      )
      .get() as { channel: string; group_id: string; user_id: string }
    expect(row).toEqual({ channel: "qq", group_id: "100", user_id: "200" })
    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("Repo reflection stats", () => {
  it("reflectCursors 解析 reflect_cursor:{channel}:{chatId} 配置", () => {
    repo.setGroupReflectCursor("qq", "100", 1700)
    repo.setGroupReflectCursor("qq", "200", 1800)
    repo.setConfigRow("app", "{}")
    const cur = repo
      .reflectCursors()
      .sort((a, b) => a.chatId.localeCompare(b.chatId))
    expect(cur).toEqual([
      { channel: "qq", chatId: "100", cursor: 1700 },
      { channel: "qq", chatId: "200", cursor: 1800 },
    ])
  })

  it("groupMessageStats 按 channel+chat 分组计数并取最近时间", () => {
    repo.bufferGroupMessage("qq", "100", "1", "member", "a")
    repo.bufferGroupMessage("qq", "100", "2", "admin", "b")
    repo.bufferGroupMessage("qq", "200", "3", "member", "c")
    const stats = repo
      .groupMessageStats()
      .sort((x, y) => x.chatId.localeCompare(y.chatId))
    expect(
      stats.map((s) => ({ c: s.channel, g: s.chatId, n: s.count }))
    ).toEqual([
      { c: "qq", g: "100", n: 2 },
      { c: "qq", g: "200", n: 1 },
    ])
    expect(stats[0].lastTs).toBeGreaterThan(0)
  })

  it("reflectionEntries 解析 human-reflection 条目的来源 chat 与时间,畸形回退 null", () => {
    const good = repo.insertKbChunk(
      "human-reflection",
      "退款 7 天到账",
      "human-reflection:qq:100:1700"
    )
    const legacy = repo.insertKbChunk(
      "human-reflection",
      "旧格式",
      "human-reflection:100:1600"
    )
    const bad = repo.insertKbChunk(
      "human-reflection",
      "无来源格式",
      "human-reflection"
    )
    repo.insertKbChunk("faq/x.md", "普通文档", "faq/x.md")
    const es = repo.reflectionEntries()
    expect(es.length).toBe(3)
    const g = es.find((e) => e.id === good)!
    expect(g.channel).toBe("qq")
    expect(g.chatId).toBe("100")
    expect(g.ts).toBe(1700)
    const leg = es.find((e) => e.id === legacy)!
    expect(leg.channel).toBe("qq")
    expect(leg.chatId).toBe("100")
    expect(leg.ts).toBe(1600)
    const b = es.find((e) => e.id === bad)!
    expect(b.channel).toBeNull()
    expect(b.chatId).toBeNull()
    expect(b.ts).toBeNull()
  })
})

describe("searchBaseKb", () => {
  it("只返回非 human-reflection 条目", () => {
    repo.insertKbEntry(
      "faq/x.md",
      "基础文档内容",
      "faq/x.md",
      new Float32Array([1, 0, 0])
    )
    repo.insertKbEntry(
      "human-reflection",
      "反思内容",
      "human-reflection:qq:100:1",
      new Float32Array([1, 0, 0])
    )
    const hits = repo.searchBaseKb(new Float32Array([1, 0, 0]), 5)
    expect(hits).toHaveLength(1)
    expect(hits[0].content).toBe("基础文档内容")
  })

  it("反思聚集也能凑够 k 条基础条目", () => {
    // 同一向量下 5 条反思 + 3 条基础;plain k=3 会被反思占满返回 0 条基础
    const vec = () => new Float32Array([1, 0, 0])
    for (let i = 0; i < 5; i++)
      repo.insertKbEntry(
        "human-reflection",
        `反思${i}`,
        `human-reflection:qq:1:${i}`,
        vec()
      )
    for (let i = 0; i < 3; i++)
      repo.insertKbEntry("faq/f.md", `基础${i}`, "faq/f.md", vec())
    const hits = repo.searchBaseKb(vec(), 3)
    expect(hits).toHaveLength(3)
    expect(hits.every((h) => h.content.startsWith("基础"))).toBe(true)
  })
})

describe("replaceReflectionEntries", () => {
  const vec = () => new Float32Array([1, 0, 0])

  it("删旧 human-reflection + 插新,不动基础文档,向量数一致", () => {
    repo.insertKbEntry("faq/x.md", "基础", "faq/x.md", vec())
    repo.insertKbEntry(
      "human-reflection",
      "旧1",
      "human-reflection:qq:100:1",
      vec()
    )
    repo.insertKbEntry(
      "human-reflection",
      "旧2",
      "human-reflection:qq:100:2",
      vec()
    )
    const oldIds = repo.reflectionEntries().map((r) => r.id)
    repo.replaceReflectionEntries(
      oldIds,
      [{ content: "新条", embedding: vec() }],
      12345
    )
    const refs = repo.reflectionEntries()
    expect(refs).toHaveLength(1)
    expect(refs[0].content).toBe("新条")
    expect(refs[0].channel).toBe("qq")
    expect(refs[0].chatId).toBe("0")
    expect(refs[0].ts).toBe(12345)
    expect(repo.searchBaseKb(vec(), 5)).toHaveLength(1)
    const t = repo.kbTotals()
    expect(t.chunks).toBe(t.vecs)
  })

  it("只删快照内 id,压缩期间并发新增的反思条目存活", () => {
    repo.insertKbEntry(
      "human-reflection",
      "旧1",
      "human-reflection:qq:100:1",
      vec()
    )
    repo.insertKbEntry(
      "human-reflection",
      "旧2",
      "human-reflection:qq:100:2",
      vec()
    )
    const snapshot = repo.reflectionEntries().map((r) => r.id) // 2 条
    // 模拟压缩 await 期间 poller 并发插入
    repo.insertKbEntry(
      "human-reflection",
      "并发新增",
      "human-reflection:qq:200:9",
      vec()
    )
    repo.replaceReflectionEntries(
      snapshot,
      [{ content: "整理后", embedding: vec() }],
      500
    )
    const contents = repo
      .reflectionEntries()
      .map((r) => r.content)
      .sort()
    expect(contents).toEqual(["并发新增", "整理后"]) // 并发条目未被误删
    const t = repo.kbTotals()
    expect(t.chunks).toBe(t.vecs) // 无孤儿
  })
})

describe("repo 主动兜底支持", () => {
  const mk = () => new Repo(openDb(":memory:"))

  it("sessionUpdatedAt:无会话→undefined,写入后→数值", () => {
    const r = mk()
    expect(r.sessionUpdatedAt("1:2")).toBeUndefined()
    r.setSessionId("1:2", "sess-a")
    expect(typeof r.sessionUpdatedAt("1:2")).toBe("number")
  })

  it("groupProactiveCursor:默认0,可设可读", () => {
    const r = mk()
    expect(r.groupProactiveCursor("qq", "100")).toBe(0)
    r.setGroupProactiveCursor("qq", "100", 12345)
    expect(r.groupProactiveCursor("qq", "100")).toBe(12345)
  })

  it("groupMemberMessagesBetween:只取(after,until]内非管理发言,升序", () => {
    const r = mk()
    const seed = (
      uid: string,
      role: string | null,
      text: string,
      at: number
    ) =>
      (r as any).db
        .prepare(
          "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
        )
        .run("qq", "100", uid, role, text, at)
    seed("200", "member", "太早", 100) // <= after,排除
    seed("200", "member", "问题A", 200)
    seed("201", null, "问题B", 300)
    seed("202", "admin", "管理发言", 400) // 管理,排除
    seed("203", "owner", "群主发言", 450) // 群主,排除
    seed("200", "member", "太新", 900) // > until,排除
    const rows = r.groupMemberMessagesBetween("qq", "100", 100, 500)
    expect(rows.map((row) => row.text)).toEqual(["问题A", "问题B"])
    expect(rows[0]).toMatchObject({ userId: "200", createdAt: 200 })
  })

  it("bufferGroupMessage:存 messageId 并由 groupMemberMessagesBetween 带出;缺省 → null", () => {
    const r = mk()
    r.bufferGroupMessage("qq", "100", "200", "member", "带 id", "8001")
    r.bufferGroupMessage("qq", "100", "201", "member", "无 id") // 缺省
    const rows = r.groupMemberMessagesBetween("qq", "100", 0, Date.now() + 1000)
    const byUser = Object.fromEntries(rows.map((row) => [row.userId, row.messageId]))
    expect(byUser["200"]).toBe("8001")
    expect(byUser["201"]).toBeNull()
  })
})

describe("question ranking schema", () => {
  it("question_topics / question_occurrences 表存在且可写", () => {
    const r = new Repo(openDb(":memory:", 3))
    const d = (r as any).db as import("better-sqlite3").Database
    d.prepare("INSERT INTO question_topics (title) VALUES (?)").run("退款相关")
    const tid = (
      d.prepare("SELECT id FROM question_topics").get() as { id: number }
    ).id
    d.prepare(
      "INSERT INTO question_occurrences (topic_id, channel, group_id, user_id, text, msg_ts) VALUES (?,?,?,?,?,?)"
    ).run(tid, "qq", "100", "200", "怎么退款", 1000)
    const n = (
      d.prepare("SELECT COUNT(*) n FROM question_occurrences").get() as {
        n: number
      }
    ).n
    expect(n).toBe(1)
  })
})

describe("ranking repo 写入与游标", () => {
  it("upsertTopic 复用同名主题;insertOccurrence 落库;topicCursor 读写", () => {
    const r = new Repo(openDb(":memory:", 3))
    const t1 = r.insertQuestionTopic("退款相关", 1000)
    const t2 = r.insertQuestionTopic("退款相关", 2000) // 已存在同名 → 复用
    expect(t2).toBe(t1)
    r.insertQuestionOccurrence(t1, "qq", "100", "200", "怎么退款", 1500)
    expect(r.topicCursor("qq", "100")).toBe(0)
    r.setTopicCursor("qq", "100", 1500)
    expect(r.topicCursor("qq", "100")).toBe(1500)
  })

  it("questionTopics 按 updated_at DESC 返回 {id,title}", () => {
    const r = new Repo(openDb(":memory:", 3))
    const t1 = r.insertQuestionTopic("退款相关", 1000)
    const t2 = r.insertQuestionTopic("改密码", 2000) // updated_at 更新 → 排前
    const list = r.questionTopics()
    expect(list).toEqual([
      { id: t2, title: "改密码" },
      { id: t1, title: "退款相关" },
    ])
  })
})

describe("ranking repo 聚合", () => {
  it("rankingByWindow 按 msg_ts 窗口计数并降序;topicSamples 取样;minTopicCursor 忽略 0", () => {
    const r = new Repo(openDb(":memory:", 3))
    const a = r.insertQuestionTopic("退款", 0)
    const b = r.insertQuestionTopic("改密码", 0)
    r.insertQuestionOccurrence(a, "qq", "100", "1", "怎么退款", 1000)
    r.insertQuestionOccurrence(a, "qq", "100", "2", "退款多久", 2000)
    r.insertQuestionOccurrence(b, "qq", "100", "3", "改密码", 500)
    // 窗口 [1500, ∞):只剩 a 的 1 条
    const win = r.rankingByWindow(1500)
    expect(win[0]).toMatchObject({ id: a, count: 1 })
    // 全部窗口(sinceTs=0):a=2 排 b=1 前
    const all = r.rankingByWindow(0)
    expect(all.map((row) => row.count)).toEqual([2, 1])
    expect(all[0].id).toBe(a)
    // topicSamples 按 msg_ts DESC:ts=2000 的"退款多久" 在前,ts=1000 的"怎么退款" 在后
    expect(r.topicSamples(a, 5)).toEqual(["退款多久", "怎么退款"])
    // minTopicCursor:群100 游标 3000,群200 无游标(0)→ 忽略,取 3000
    r.setTopicCursor("qq", "100", 3000)
    expect(
      r.minTopicCursor([
        { channel: "qq", chatId: "100" },
        { channel: "qq", chatId: "200" },
      ])
    ).toBe(3000)
    // 全部为 0 → MAX_SAFE_INTEGER(不约束 prune)
    expect(r.minTopicCursor([{ channel: "qq", chatId: "200" }])).toBe(
      Number.MAX_SAFE_INTEGER
    )
    // number[] 兼容(视为 qq)
    expect(r.minTopicCursor([100, 200])).toBe(3000)
  })

  it("topicSamples 按 text 去重:同句重复只展示一次,计数不受影响", () => {
    const r = new Repo(openDb(":memory:", 3))
    const a = r.insertQuestionTopic("超时", 0)
    r.insertQuestionOccurrence(a, "qq", "100", "1", "任务超时怎么办", 1000)
    r.insertQuestionOccurrence(a, "qq", "100", "2", "任务超时怎么办", 2000) // 同句重复
    r.insertQuestionOccurrence(a, "qq", "100", "3", "超时会重复扣费吗", 3000)
    expect(r.rankingByWindow(0)[0].count).toBe(3) // 计数含重复
    // 样例去重 → 只两条,最近的重复句取 max ts 排前
    expect(r.topicSamples(a, 5)).toEqual([
      "超时会重复扣费吗",
      "任务超时怎么办",
    ])
  })

  it("rankingByWindow count 相同按 lastTs DESC", () => {
    const r = new Repo(openDb(":memory:", 3))
    const c = r.insertQuestionTopic("c", 0)
    const d = r.insertQuestionTopic("d", 0)
    r.insertQuestionOccurrence(c, "qq", "100", "1", "c1", 2000) // ts 更大 → 排前
    r.insertQuestionOccurrence(d, "qq", "100", "2", "d1", 1000)
    const rows = r.rankingByWindow(0)
    expect(rows.map((row) => row.count)).toEqual([1, 1]) // count 相同
    expect(rows.map((row) => row.id)).toEqual([c, d]) // lastTs DESC → c 在前
  })
})

describe("prior_since schema migration", () => {
  it("全新 openDb 有 prior_since 且 user_version >= 3", () => {
    const d = openDb(":memory:", 3)
    const cols = (
      d.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
    ).map((c) => c.name)
    expect(cols).toContain("prior_since")
    expect(d.pragma("user_version", { simple: true }) as number).toBeGreaterThanOrEqual(
      3
    )
    d.close()
  })

  it("磁盘 v2 库无 prior_since 时 openDb 升级补列并升到 user_version >= 3", () => {
    const dir = mkdtempSync(join(tmpdir(), "prayer-v3-"))
    const p = join(dir, "v2.db")
    // 手工造最小 v2 形态:sessions 无 prior_since,user_version=2
    const raw = new BetterSqlite3(p)
    raw.exec(`
      CREATE TABLE sessions (
        key TEXT PRIMARY KEY,
        session_id TEXT,
        resume_id TEXT,
        human_mode INTEGER NOT NULL DEFAULT 0,
        human_since INTEGER,
        last_question TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL DEFAULT 'qq',
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sender_role TEXT,
        text TEXT NOT NULL,
        message_id TEXT,
        created_at INTEGER NOT NULL DEFAULT 0
      );
    `)
    raw.pragma("user_version = 2")
    raw.prepare(
      "INSERT INTO sessions (key, session_id, updated_at) VALUES (?, ?, ?)"
    ).run("qq:1:2", "sid", 100)
    raw.close()

    // 升级路径必须走 openDb(加载 sqlite-vec + migrate)
    const upgraded = openDb(p, 3)
    const cols = (
      upgraded.prepare("PRAGMA table_info(sessions)").all() as {
        name: string
      }[]
    ).map((c) => c.name)
    expect(cols).toContain("prior_since")
    expect(
      upgraded.pragma("user_version", { simple: true }) as number
    ).toBeGreaterThanOrEqual(3)
    // 原数据保留
    const row = upgraded
      .prepare("SELECT key, session_id, prior_since FROM sessions")
      .get() as { key: string; session_id: string; prior_since: number | null }
    expect(row).toEqual({
      key: "qq:1:2",
      session_id: "sid",
      prior_since: null,
    })
    // 用户 lookback 复合索引已建
    const idx = upgraded
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type='index' AND name='idx_gm_channel_group_user_time'"
      )
      .get() as { ok: number } | undefined
    expect(idx?.ok).toBe(1)
    upgraded.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("channel schema migration", () => {
  it("group_messages 支持 channel 与复合唯一", () => {
    const r = new Repo(openDb(":memory:", 3))
    r.bufferGroupMessage("qq", "100", "200", "member", "hi", "1")
    r.bufferGroupMessage("tg", "100", "200", "member", "hi", "1")
    const n = (
      ((r as any).db as Database.Database)
        .prepare("SELECT COUNT(*) AS c FROM group_messages")
        .get() as { c: number }
    ).c
    expect(n).toBe(2)
    // 同 channel 重复 message_id 忽略
    r.bufferGroupMessage("qq", "100", "200", "member", "hi again", "1")
    const n2 = (
      ((r as any).db as Database.Database)
        .prepare("SELECT COUNT(*) AS c FROM group_messages")
        .get() as { c: number }
    ).c
    expect(n2).toBe(2)
  })

  it("seenMessage 用 dedupe_key", () => {
    const r = new Repo(openDb(":memory:", 3))
    expect(r.seenMessage("qq:1:2")).toBe(false)
    expect(r.seenMessage("qq:1:2")).toBe(true)
    expect(r.seenMessage("tg:1:2")).toBe(false) // 不同 channel 独立
  })

  it("legacy session key 迁移为 canonical", () => {
    const r = new Repo(openDb(":memory:", 3))
    const d = (r as any).db as Database.Database
    // openDb 已迁完空库;手动插入旧 key 后补跑
    d.prepare(
      "INSERT INTO sessions (key, session_id, updated_at) VALUES (?, ?, ?)"
    ).run("123:456", "sid-old", 1000)
    d.prepare(
      "INSERT INTO sessions (key, session_id, updated_at) VALUES (?, ?, ?)"
    ).run("qq:123:456", "sid-new", 2000) // 冲突:保留较新
    d.prepare(
      "INSERT INTO tickets (session_key, summary) VALUES (?, ?)"
    ).run("789:101", "旧工单")
    d.prepare(
      "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("reflect_cursor:42", "999", 1000)
    d.prepare(
      "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("topic_cursor:42", "888", 1000)
    d.prepare(
      "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("proactive_cursor:42", "777", 1000)
    // 已带 channel 的不应双迁
    d.prepare(
      "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("reflect_cursor:qq:99", "1", 1000)

    migrateLegacySessionKeys(d)
    // config 游标迁移在 openDb 的 migrateToV2 内;此处模拟重跑:再 open 无帮助
    // 直接验证 sessions/tickets
    const sessionKeys = (
      d.prepare("SELECT key, session_id, updated_at FROM sessions").all() as {
        key: string
        session_id: string
        updated_at: number
      }[]
    ).sort((a, b) => a.key.localeCompare(b.key))
    expect(sessionKeys).toEqual([
      { key: "qq:123:456", session_id: "sid-new", updated_at: 2000 },
    ])
    const ticket = d
      .prepare("SELECT session_key FROM tickets WHERE summary = '旧工单'")
      .get() as { session_key: string }
    expect(ticket.session_key).toBe("qq:789:101")
  })

  it("旧盘库 openDb 迁移 sessions/cursors/group_messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "prayer-v2-"))
    const p = join(dir, "legacy.db")
    const raw = new BetterSqlite3(p)
    raw.exec(`
      CREATE TABLE sessions (
        key TEXT PRIMARY KEY,
        session_id TEXT,
        resume_id TEXT,
        human_mode INTEGER NOT NULL DEFAULT 0,
        human_since INTEGER,
        last_question TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        sender_role TEXT,
        text TEXT NOT NULL,
        message_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE seen_messages (
        message_id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL DEFAULT 0
      );
    `)
    raw.prepare(
      "INSERT INTO sessions (key, session_id, updated_at) VALUES (?, ?, ?)"
    ).run("100:200", "s1", 50)
    raw.prepare(
      "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("reflect_cursor:100", "12345", 1)
    raw.prepare(
      "INSERT INTO group_messages (group_id,user_id,sender_role,text,message_id,created_at) VALUES (?,?,?,?,?,?)"
    ).run(100, 200, "member", "hi", 9, 10)
    raw.prepare(
      "INSERT INTO tickets (session_key, summary) VALUES (?, ?)"
    ).run("100:200", "t1")
    raw.close()

    const migrated = openDb(p, 3)
    // v1→v2→v3 一路升完
    expect(
      (migrated.pragma("user_version", { simple: true }) as number)
    ).toBe(3)
    const sk = migrated
      .prepare("SELECT key FROM sessions")
      .get() as { key: string }
    expect(sk.key).toBe("qq:100:200")
    const cur = migrated
      .prepare("SELECT key, value FROM config WHERE key LIKE 'reflect_cursor%'")
      .get() as { key: string; value: string }
    expect(cur).toEqual({ key: "reflect_cursor:qq:100", value: "12345" })
    const gm = migrated
      .prepare(
        "SELECT channel, group_id, user_id, message_id FROM group_messages"
      )
      .get() as {
      channel: string
      group_id: string
      user_id: string
      message_id: string
    }
    expect(gm).toEqual({
      channel: "qq",
      group_id: "100",
      user_id: "200",
      message_id: "9",
    })
    // seen_messages 清空重建
    const seenCols = (
      migrated.prepare("PRAGMA table_info(seen_messages)").all() as {
        name: string
      }[]
    ).map((c) => c.name)
    expect(seenCols).toContain("dedupe_key")
    expect(seenCols).not.toContain("message_id")
    const tk = migrated
      .prepare("SELECT session_key FROM tickets")
      .get() as { session_key: string }
    expect(tk.session_key).toBe("qq:100:200")
    // 幂等:再 open 不炸
    migrated.close()
    const again = openDb(p, 3)
    expect(again.pragma("user_version", { simple: true })).toBe(3)
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
