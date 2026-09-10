import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { access, mkdir, unlink } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { readUserVersion } from "./migrations/index.ts"

export type DatabaseIntegrity = Readonly<{
  ok: boolean
  messages: string[]
}>

export type DatabaseBackup = Readonly<{
  path: string
  userVersion: number
  totalPages: number
}>

/** 执行完整检查；返回的非 ok 行保留 SQLite 原始诊断，便于运维定位。 */
export function checkDatabaseIntegrity(
  db: Database.Database
): DatabaseIntegrity {
  const rows = db.pragma("integrity_check") as Record<string, unknown>[]
  const messages = rows.flatMap((row) =>
    Object.values(row).map((value) => String(value))
  )
  return {
    ok: messages.length === 1 && messages[0].toLowerCase() === "ok",
    messages,
  }
}

export function assertDatabaseIntegrity(db: Database.Database): void {
  const result = checkDatabaseIntegrity(db)
  if (!result.ok) {
    throw new Error(`数据库完整性检查失败：${result.messages.join("；")}`)
  }
}

/** 只读验证备份文件，不执行迁移，避免检查动作修改待恢复数据。 */
export function verifyDatabaseFile(path: string): DatabaseIntegrity {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    sqliteVec.load(db)
    return checkDatabaseIntegrity(db)
  } finally {
    db.close()
  }
}

/**
 * 使用 SQLite 在线备份 API 获取一致快照，并在返回前重新打开校验。
 * 目标文件必须不存在，防止定时任务或路径错误覆盖最后一份可用备份。
 */
export async function backupDatabase(
  db: Database.Database,
  destinationPath: string
): Promise<DatabaseBackup> {
  const destination = resolve(destinationPath)
  if (db.name !== ":memory:" && resolve(db.name) === destination) {
    throw new Error("备份目标不能与当前数据库相同")
  }
  await access(destination).then(
    () => {
      throw new Error(`备份目标已存在：${destination}`)
    },
    () => undefined
  )

  assertDatabaseIntegrity(db)
  await mkdir(dirname(destination), { recursive: true })

  try {
    const metadata = await db.backup(destination)
    const integrity = verifyDatabaseFile(destination)
    if (!integrity.ok) {
      throw new Error(`备份完整性检查失败：${integrity.messages.join("；")}`)
    }
    return {
      path: destination,
      userVersion: readUserVersion(db),
      totalPages: metadata.totalPages,
    }
  } catch (error) {
    // 目标原本不存在，因此这里只清理由本次调用创建的不完整文件。
    await unlink(destination).catch(() => undefined)
    throw error
  }
}
