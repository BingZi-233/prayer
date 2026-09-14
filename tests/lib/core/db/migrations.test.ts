import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { afterEach, describe, expect, it } from "vitest"
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  migrateDatabase,
} from "@/lib/core/db/migrations/index"
import { migrateToVersion9 } from "@/lib/core/db/migrations/schema"

const opened: Database.Database[] = []

function createDb(): Database.Database {
  const db = new Database(":memory:")
  sqliteVec.load(db)
  opened.push(db)
  return db
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close()
})

function userVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true }))
}

function columns(db: Database.Database, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => (row as { name: string }).name)
}

function indexExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?")
      .get(name)
  )
}

describe("数据库迁移注册表", () => {
  it("版本连续、唯一，并与当前版本常量一致", () => {
    const versions = MIGRATIONS.map((migration) => migration.version)
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    expect(new Set(versions).size).toBe(versions.length)
    expect(CURRENT_SCHEMA_VERSION).toBe(9)
    expect(MIGRATIONS.every((migration) => migration.name.length > 0)).toBe(
      true
    )
  })

  it("全新数据库可逐版本升级，并可在每一级幂等重跑", () => {
    const db = createDb()

    for (const targetVersion of [2, 3, 4, 5, 6, 7, 8, 9]) {
      migrateDatabase(db, 3, targetVersion)
      expect(userVersion(db)).toBe(targetVersion)

      // 同一版本再次启动会走 repair，必须保持可用且版本不变。
      migrateDatabase(db, 3, targetVersion)
      expect(userVersion(db)).toBe(targetVersion)
    }

    expect(columns(db, "group_messages")).toContain("channel")
    expect(columns(db, "sessions")).toContain("prior_since")
    expect(columns(db, "group_messages")).toContain("mentioned_bot")
    expect(columns(db, "tool_stats_daily")).toContain("tool")
    expect(indexExists(db, "idx_qt_title")).toBe(true)
    expect(indexExists(db, "idx_seen_created")).toBe(true)
    expect(indexExists(db, "idx_qt_updated_at")).toBe(true)
    expect(indexExists(db, "idx_sessions_human_since")).toBe(true)
    expect(indexExists(db, "idx_tickets_status_created")).toBe(true)
    expect(indexExists(db, "idx_qo_topic_msg_ts")).toBe(true)
    expect(indexExists(db, "idx_outbox_resolution_status")).toBe(true)
  })

  it("v9 preserves legacy rows and defaults delivery state to sent", () => {
    const db = createDb()
    migrateDatabase(db, 3, 8)
    db.prepare(
      "INSERT INTO resolution_events (kind, session_key, detail) VALUES (?, ?, ?)"
    ).run("auto", "legacy-session", "legacy")
    db.prepare(
      "INSERT INTO proactive_replies (channel, group_id, user_id, question, answer) VALUES (?, ?, ?, ?, ?)"
    ).run("qq", "100", "200", "legacy question", "legacy answer")

    migrateDatabase(db, 3, 9)

    expect(
      db.prepare("SELECT COUNT(*) AS n FROM resolution_events").get()
    ).toEqual({ n: 1 })
    expect(
      db.prepare("SELECT delivery_status FROM resolution_events").get()
    ).toEqual({ delivery_status: "sent" })
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM proactive_replies").get()
    ).toEqual({ n: 1 })
    expect(
      db.prepare("SELECT delivery_status FROM proactive_replies").get()
    ).toEqual({ delivery_status: "sent" })
    expect(indexExists(db, "idx_resolution_events_delivery_key")).toBe(true)
    expect(indexExists(db, "idx_proactive_replies_delivery_key")).toBe(true)
  })

  it("v9 空的 partial outbox 会重建为完整 canonical schema", () => {
    const db = createDb()
    db.exec(
      "CREATE TABLE outbox_messages (id INTEGER PRIMARY KEY, delivery_key TEXT)"
    )

    migrateToVersion9(db)

    expect(columns(db, "outbox_messages")).toEqual([
      "id",
      "delivery_key",
      "resolution_key",
      "action_json",
      "status",
      "attempts",
      "next_attempt_at",
      "lease_until",
      "claim_token",
      "last_error",
      "sent_at",
    ])
    expect(
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='outbox_messages'"
        )
        .get()
    ).toMatchObject({ sql: expect.stringContaining("CHECK(status IN") })
    expect(indexExists(db, "idx_outbox_due")).toBe(true)
    expect(indexExists(db, "idx_outbox_resolution_status")).toBe(true)

    db.prepare(
      "INSERT INTO outbox_messages (delivery_key, action_json) VALUES (?, ?)"
    ).run("canonical", "{}")
    expect(() =>
      db
        .prepare(
          "INSERT INTO outbox_messages (delivery_key, action_json, status) VALUES (?, ?, ?)"
        )
        .run("bad-status", "{}", "unknown")
    ).toThrow()
    expect(() =>
      db
        .prepare(
          "INSERT INTO outbox_messages (delivery_key, action_json) VALUES (?, ?)"
        )
        .run("canonical", "{}")
    ).toThrow()
  })

  it("v9 非空 partial outbox 只补可空列并保留存量行", () => {
    const db = createDb()
    db.exec(`
      CREATE TABLE outbox_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_key TEXT NOT NULL,
        action_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO outbox_messages (delivery_key, action_json)
      VALUES ('legacy-outbox', '{}');
    `)

    migrateToVersion9(db)

    expect(columns(db, "outbox_messages")).toEqual([
      "id",
      "delivery_key",
      "action_json",
      "status",
      "attempts",
      "next_attempt_at",
      "resolution_key",
      "lease_until",
      "claim_token",
      "last_error",
      "sent_at",
    ])
    expect(
      db
        .prepare(
          "SELECT delivery_key, action_json, claim_token FROM outbox_messages"
        )
        .get()
    ).toEqual({
      delivery_key: "legacy-outbox",
      action_json: "{}",
      claim_token: null,
    })
    expect(indexExists(db, "idx_outbox_due")).toBe(true)
    expect(indexExists(db, "idx_outbox_resolution_status")).toBe(true)
    expect(() =>
      db
        .prepare(
          "INSERT INTO outbox_messages (delivery_key, action_json) VALUES (?, ?)"
        )
        .run("legacy-outbox", "{}")
    ).toThrow()
  })

  it("v9 非空 outbox 缺关键列时明确失败且不改写存量数据", () => {
    const db = createDb()
    db.exec(`
      CREATE TABLE outbox_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO outbox_messages (delivery_key) VALUES ('incomplete');
    `)

    expect(() => migrateToVersion9(db)).toThrow(
      /v9 outbox_messages 非空表缺少关键列：.*action_json/
    )
    expect(columns(db, "outbox_messages")).toEqual([
      "id",
      "delivery_key",
      "status",
      "attempts",
      "next_attempt_at",
    ])
    expect(
      db.prepare("SELECT delivery_key FROM outbox_messages").get()
    ).toEqual({ delivery_key: "incomplete" })
  })

  it("v9 拒绝状态或 delivery_key 已损坏的存量行", () => {
    const db = createDb()
    db.exec(`
      CREATE TABLE outbox_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_key TEXT NOT NULL,
        action_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        resolution_key TEXT,
        lease_until INTEGER,
        claim_token TEXT,
        last_error TEXT,
        sent_at INTEGER
      );
      INSERT INTO outbox_messages (delivery_key, action_json, status)
      VALUES ('broken', '{}', 'unknown');
    `)

    expect(() => migrateToVersion9(db)).toThrow(
      /v9 outbox_messages 存量数据不符合约束/
    )
  })

  it("迁移失败时回滚当前版本，修复原因后可从断点继续", () => {
    const db = createDb()
    migrateDatabase(db, 3, 5)

    db.exec(`
      INSERT INTO question_topics (title) VALUES ('重复主题'), ('重复主题');
      INSERT INTO question_occurrences
        (topic_id, channel, group_id, user_id, text, msg_ts)
      VALUES (2, 'qq', '100', '1', '问题', 1000);
      CREATE TEMP TRIGGER fail_topic_merge
      BEFORE UPDATE OF topic_id ON question_occurrences
      BEGIN SELECT RAISE(ABORT, '模拟 v6 迁移失败'); END;
    `)

    expect(() => migrateDatabase(db, 3, 6)).toThrow("模拟 v6 迁移失败")
    expect(userVersion(db)).toBe(5)
    expect(indexExists(db, "idx_re_created_at")).toBe(false)
    expect(
      db.prepare("SELECT COUNT(*) FROM question_topics").pluck().get()
    ).toBe(2)
    expect(
      db.prepare("SELECT topic_id FROM question_occurrences").pluck().get()
    ).toBe(2)

    db.exec("DROP TRIGGER fail_topic_merge")
    migrateDatabase(db, 3, 6)

    expect(userVersion(db)).toBe(6)
    expect(indexExists(db, "idx_re_created_at")).toBe(true)
    expect(
      db.prepare("SELECT COUNT(*) FROM question_topics").pluck().get()
    ).toBe(1)
    expect(
      db.prepare("SELECT topic_id FROM question_occurrences").pluck().get()
    ).toBe(1)
  })

  it("拒绝以旧程序打开更高版本数据库", () => {
    const db = createDb()
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`)

    expect(() => migrateDatabase(db, 3)).toThrow("高于当前程序支持的版本")
    expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION + 1)
  })
})
