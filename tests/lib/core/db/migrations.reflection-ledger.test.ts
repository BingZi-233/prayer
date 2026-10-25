import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { afterEach, describe, expect, it } from "vitest"
import {
  MIGRATIONS,
  migrateDatabase,
  readUserVersion,
  runMigrationPlan,
} from "@/lib/core/db/migrations/index"
import {
  migrateToVersion11,
  repairVersion11,
} from "@/lib/core/db/migrations/schema"

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

function columns(db: Database.Database): string[] {
  return (
    db.prepare("PRAGMA table_info(reflection_meta)").all() as { name: string }[]
  ).map((r) => r.name)
}

function seedChunk(db: Database.Database, source: string): number {
  const id = Number(
    db
      .prepare(
        "INSERT INTO kb_chunks (doc, content, source) VALUES ('human-reflection', 'x', ?)"
      )
      .run(source).lastInsertRowid
  )
  db.prepare(
    "INSERT INTO reflection_meta (chunk_id, channel, group_id, status) VALUES (?, 'qq', '0', 'approved')"
  ).run(id)
  return id
}

describe("迁移 v11:反思升格评审账本", () => {
  it("新库带齐账本列且默认值正确", () => {
    const db = createDb()
    migrateDatabase(db, 3)
    expect(columns(db)).toEqual(
      expect.arrayContaining(["review_state", "review_attempts", "review_note"])
    )
    const id = seedChunk(db, "human-reflection:qq:100:5")
    expect(
      db
        .prepare(
          "SELECT review_state, review_attempts, review_note FROM reflection_meta WHERE chunk_id = ?"
        )
        .get(id)
    ).toEqual({ review_state: null, review_attempts: 0, review_note: null })
  })

  it("v10 库升级到 v11:整理块标 legacy,原始反思不动", () => {
    const db = createDb()
    migrateDatabase(db, 3, 10)
    const compacted = seedChunk(db, "human-reflection:qq:0:1792921962259")
    const raw = seedChunk(db, "human-reflection:qq:698258286:1792923904177")
    const tg = seedChunk(db, "human-reflection:tg:-100123:1787025529692")
    expect(columns(db)).not.toContain("review_state")

    migrateDatabase(db, 3)
    expect(readUserVersion(db)).toBe(11)
    const state = (id: number) =>
      (
        db
          .prepare(
            "SELECT review_state FROM reflection_meta WHERE chunk_id = ?"
          )
          .get(id) as { review_state: string | null }
      ).review_state
    expect(state(compacted)).toBe("legacy")
    expect(state(raw)).toBeNull()
    expect(state(tg)).toBeNull()
  })

  it("repair 可重复执行,且不改业务数据", () => {
    const db = createDb()
    migrateDatabase(db, 3)
    const id = seedChunk(db, "human-reflection:qq:100:5")
    db.prepare(
      "UPDATE reflection_meta SET review_state='declined', review_attempts=2, review_note='n' WHERE chunk_id=?"
    ).run(id)
    repairVersion11(db)
    repairVersion11(db)
    migrateDatabase(db, 3)
    expect(
      db
        .prepare(
          "SELECT review_state, review_attempts, review_note FROM reflection_meta WHERE chunk_id = ?"
        )
        .get(id)
    ).toEqual({
      review_state: "declined",
      review_attempts: 2,
      review_note: "n",
    })
  })

  it("migrateToVersion11 对已有列可重复执行", () => {
    const db = createDb()
    migrateDatabase(db, 3)
    migrateToVersion11(db)
    expect(columns(db).filter((c) => c === "review_state")).toHaveLength(1)
  })

  it("注册表到 v11,且版本连续", () => {
    expect(MIGRATIONS.at(-1)?.version).toBe(11)
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 2))
  })

  it("旧程序(注册表截到 v10)打开 v11 库抛错", () => {
    const db = createDb()
    migrateDatabase(db, 3)
    expect(() =>
      runMigrationPlan(db, MIGRATIONS.slice(0, -1), { dim: 3 })
    ).toThrow(/高于当前程序支持的版本/)
  })
})
