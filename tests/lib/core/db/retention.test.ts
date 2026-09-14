import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { openDb } from "@/lib/core/db/index"
import {
  applyRetention,
  applyTranscriptRetention,
  DAY_MS,
  inspectRetention,
  inspectTranscriptRetention,
  type RetentionPolicy,
} from "@/lib/core/db/retention"

const NOW = Date.UTC(2026, 8, 13, 0, 0, 0)
const OLD = NOW - 31 * DAY_MS
const FRESH = NOW - DAY_MS
const POLICY: RetentionPolicy = {
  reflectCompactionsDays: 30,
  questionOccurrencesDays: 30,
  questionTopicsDays: 30,
  usageDays: 30,
  sessionsDays: 30,
  outboxSentDays: 30,
  transcriptsDays: 30,
}

const databases: Database.Database[] = []
const directories: string[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) if (db.open) db.close()
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true }))
  )
})

function database(): Database.Database {
  const db = openDb(":memory:", 3)
  databases.push(db)
  return db
}

function count(db: Database.Database, table: string): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  )
}

function seedRetentionRows(db: Database.Database): void {
  const compaction = db.prepare(
    "INSERT INTO reflect_compactions (ts, before_count, after_count, before_json, after_json) VALUES (?, 1, 1, '[]', '[]')"
  )
  compaction.run(OLD)
  compaction.run(FRESH)

  const topic = db.prepare(
    "INSERT INTO question_topics (title, created_at, updated_at) VALUES (?, ?, ?)"
  )
  const oldTopic = Number(topic.run("old", OLD, OLD).lastInsertRowid)
  const freshTopic = Number(topic.run("fresh", FRESH, FRESH).lastInsertRowid)
  const occurrence = db.prepare(
    "INSERT INTO question_occurrences (topic_id, channel, group_id, user_id, text, msg_ts) VALUES (?, 'qq', 'g', 'u', 'q', ?)"
  )
  occurrence.run(oldTopic, OLD)
  occurrence.run(freshTopic, FRESH)

  db.prepare(
    "INSERT INTO usage_daily (day, site, count) VALUES (?, 'agent', 1)"
  ).run("2026-07-01")
  db.prepare(
    "INSERT INTO usage_daily (day, site, count) VALUES (?, 'agent', 1)"
  ).run("2026-09-12")
  db.prepare(
    "INSERT INTO tool_stats_daily (day, site, tool, runs, calls) VALUES (?, 'agent', 'Skill', 1, 1)"
  ).run("2026-07-01")
  db.prepare(
    "INSERT INTO tool_stats_daily (day, site, tool, runs, calls) VALUES (?, 'agent', 'Skill', 1, 1)"
  ).run("2026-09-12")

  const session = db.prepare(
    "INSERT INTO sessions (key, resume_id, human_mode, updated_at) VALUES (?, ?, ?, ?)"
  )
  session.run("eligible", null, 0, OLD)
  session.run("resume", "resume-id", 0, OLD)
  session.run("human", null, 1, OLD)
  session.run("ticket", null, 0, OLD)
  session.run("closed-ticket", null, 0, OLD)
  session.run("fresh", null, 0, FRESH)
  db.prepare(
    "INSERT INTO tickets (session_key, summary, status) VALUES ('ticket', 'help', 'open')"
  ).run()
  db.prepare(
    "INSERT INTO tickets (session_key, summary, status) VALUES ('closed-ticket', 'done', 'closed')"
  ).run()
}

describe("database retention", () => {
  it("reports candidates without deleting, then applies all rules atomically", () => {
    const db = database()
    seedRetentionRows(db)

    const report = inspectRetention(db, NOW, POLICY)
    expect(
      Object.fromEntries(
        report.tables.map((row) => [row.table, row.candidates])
      )
    ).toMatchObject({
      reflect_compactions: 1,
      question_occurrences: 1,
      question_topics: 1,
      usage_daily: 1,
      tool_stats_daily: 1,
      sessions: 1,
      outbox_messages: 0,
    })
    expect(
      report.tables.find((row) => row.table === "sessions")?.protected
    ).toBe(4)
    expect(count(db, "reflect_compactions")).toBe(2)

    const applied = applyRetention(db, NOW, POLICY)
    expect(applied.deleted).toEqual({
      reflect_compactions: 1,
      question_occurrences: 1,
      question_topics: 1,
      usage_daily: 1,
      tool_stats_daily: 1,
      sessions: 1,
      outbox_messages: 0,
    })
    expect(applied.after.totalCandidates).toBe(0)
    expect(count(db, "reflect_compactions")).toBe(1)
    expect(count(db, "question_occurrences")).toBe(1)
    expect(count(db, "question_topics")).toBe(1)
    expect(count(db, "usage_daily")).toBe(1)
    expect(count(db, "tool_stats_daily")).toBe(1)
    expect(
      db.prepare("SELECT key FROM sessions ORDER BY key").pluck().all()
    ).toEqual(["closed-ticket", "fresh", "human", "resume", "ticket"])
  })

  it("rejects an unsafe zero-day policy", () => {
    const db = database()
    expect(() =>
      inspectRetention(db, NOW, { ...POLICY, sessionsDays: 0 })
    ).toThrow("sessionsDays 必须是 1 到 36500 之间的整数")
  })

  it("只清理过期 sent outbox，保留其它状态", () => {
    const db = database()
    const insert = db.prepare(
      "INSERT INTO outbox_messages (delivery_key, action_json, status, attempts, next_attempt_at, sent_at) VALUES (?, '{}', ?, 1, 0, ?)"
    )
    insert.run("old-sent", "sent", OLD)
    insert.run("fresh-sent", "sent", FRESH)
    insert.run("pending", "pending", null)
    insert.run("sending", "sending", null)
    insert.run("failed", "failed", null)

    const report = inspectRetention(db, NOW, POLICY)
    expect(
      report.tables.find((row) => row.table === "outbox_messages")
    ).toMatchObject({ candidates: 1, available: true })

    const applied = applyRetention(db, NOW, POLICY)
    expect(applied.deleted.outbox_messages).toBe(1)
    expect(
      db
        .prepare("SELECT delivery_key, status FROM outbox_messages ORDER BY id")
        .all()
    ).toEqual([
      { delivery_key: "fresh-sent", status: "sent" },
      { delivery_key: "pending", status: "pending" },
      { delivery_key: "sending", status: "sending" },
      { delivery_key: "failed", status: "failed" },
    ])
  })

  it("部分数据库只报告缺表，拒绝 apply 造成半清理", () => {
    const db = database()
    db.exec("DROP TABLE sessions")
    const report = inspectRetention(db, NOW, POLICY)
    expect(report.tables.find((row) => row.table === "sessions")).toMatchObject({
      available: false,
    })
    expect(() => applyRetention(db, NOW, POLICY)).toThrow(/缺少表:.*sessions/)
  })
})

describe("transcript retention", () => {
  it("is read-only until apply and only deletes old JSONL files", async () => {
    const root = await mkdtemp(join(tmpdir(), "prayer-transcript-retention-"))
    directories.push(root)
    const nested = join(root, "project")
    await mkdir(nested)
    const oldJsonl = join(nested, "old.jsonl")
    const freshJsonl = join(nested, "fresh.jsonl")
    const oldText = join(nested, "old.txt")
    await Promise.all([
      writeFile(oldJsonl, "old transcript"),
      writeFile(freshJsonl, "fresh transcript"),
      writeFile(oldText, "not a transcript"),
    ])
    const oldDate = new Date(OLD)
    await Promise.all([
      utimes(oldJsonl, oldDate, oldDate),
      utimes(oldText, oldDate, oldDate),
    ])

    const report = inspectTranscriptRetention(root, NOW, 30)
    expect(report).toMatchObject({
      available: true,
      files: 2,
      candidates: 1,
      errors: 0,
    })
    await expect(access(oldJsonl)).resolves.toBeUndefined()

    const applied = applyTranscriptRetention(root, NOW, 30)
    expect(applied.deleted).toBe(1)
    expect(applied.deletedBytes).toBe(Buffer.byteLength("old transcript"))
    expect(applied.after).toMatchObject({ files: 1, candidates: 0 })
    await expect(access(oldJsonl)).rejects.toThrow()
    await expect(access(freshJsonl)).resolves.toBeUndefined()
    await expect(access(oldText)).resolves.toBeUndefined()
  })

  it("reports a missing root instead of traversing elsewhere", () => {
    const report = inspectTranscriptRetention(
      join(tmpdir(), "prayer-transcript-missing"),
      NOW,
      30
    )
    expect(report).toMatchObject({
      available: false,
      files: 0,
      candidates: 0,
      errors: 1,
    })
  })

  it("rejects a symlink as the transcript root", async () => {
    const root = await mkdtemp(join(tmpdir(), "prayer-transcript-root-"))
    const target = await mkdtemp(join(tmpdir(), "prayer-transcript-target-"))
    directories.push(root, target)
    const link = join(root, "projects-link")
    await symlink(target, link)
    const report = inspectTranscriptRetention(link, NOW, 30)
    expect(report).toMatchObject({ available: false, errors: 1 })
    const applied = applyTranscriptRetention(link, NOW, 30)
    expect(applied.deleted).toBe(0)
  })

  it("rejects an intermediate symlink instead of traversing its target", async () => {
    const base = await mkdtemp(join(tmpdir(), "prayer-transcript-base-"))
    const target = await mkdtemp(join(tmpdir(), "prayer-transcript-target-"))
    directories.push(base, target)
    const targetRoot = join(target, "nested")
    await mkdir(targetRoot)
    const oldJsonl = join(targetRoot, "old.jsonl")
    await writeFile(oldJsonl, "must remain")
    const oldDate = new Date(OLD)
    await utimes(oldJsonl, oldDate, oldDate)

    const link = join(base, "linked")
    await symlink(target, link)
    const linkedRoot = join(link, "nested")
    const report = inspectTranscriptRetention(linkedRoot, NOW, 30)
    expect(report).toMatchObject({ available: false, errors: 1 })
    const applied = applyTranscriptRetention(linkedRoot, NOW, 30)
    expect(applied.deleted).toBe(0)
    await expect(access(oldJsonl)).resolves.toBeUndefined()
  })
})
