import Database from "better-sqlite3"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  backupDatabase,
  checkDatabaseIntegrity,
  verifyDatabaseFile,
} from "@/lib/core/db/backup"
import { openDb } from "@/lib/core/db/index"
import { CURRENT_SCHEMA_VERSION } from "@/lib/core/db/migrations/index"

const databases: Database.Database[] = []
const directories: string[] = []

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "prayer-backup-"))
  directories.push(path)
  return path
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    if (db.open) db.close()
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true }))
  )
})

describe("数据库备份", () => {
  it("生成包含 WAL 最新写入的一致快照，并通过完整性校验", async () => {
    const directory = await tempDirectory()
    const source = openDb(join(directory, "source.db"), 3)
    databases.push(source)
    source
      .prepare("INSERT INTO config (key, value) VALUES (?, ?)")
      .run("backup-test", "已写入")

    const result = await backupDatabase(
      source,
      join(directory, "backups", "snapshot.db")
    )

    expect(result.userVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.totalPages).toBeGreaterThan(0)
    expect(verifyDatabaseFile(result.path)).toEqual({
      ok: true,
      messages: ["ok"],
    })

    const restored = openDb(result.path, 3)
    databases.push(restored)
    expect(
      restored
        .prepare("SELECT value FROM config WHERE key=?")
        .pluck()
        .get("backup-test")
    ).toBe("已写入")
  })

  it("拒绝覆盖已有备份文件", async () => {
    const directory = await tempDirectory()
    const source = openDb(join(directory, "source.db"), 3)
    databases.push(source)
    const destination = join(directory, "snapshot.db")

    await backupDatabase(source, destination)
    await expect(backupDatabase(source, destination)).rejects.toThrow(
      "备份目标已存在"
    )
  })

  it("完整数据库返回 ok，损坏文件无法通过只读验证", async () => {
    const db = openDb(":memory:", 3)
    databases.push(db)
    expect(checkDatabaseIntegrity(db)).toEqual({ ok: true, messages: ["ok"] })

    const directory = await tempDirectory()
    const corrupt = join(directory, "corrupt.db")
    await writeFile(corrupt, "not-a-sqlite-database")
    expect(() => verifyDatabaseFile(corrupt)).toThrow()
  })
})
