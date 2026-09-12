import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { afterEach, describe, expect, it } from "vitest"
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  migrateDatabase,
} from "@/lib/core/db/migrations/index"

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
