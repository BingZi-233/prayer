import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { readUserVersion } from "./migrations/index.ts"
import { databaseOpenPath } from "./path.ts"

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
  const db = new Database(databaseOpenPath(path), {
    readonly: true,
    fileMustExist: true,
  })
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
  const destination = databaseOpenPath(destinationPath)
  if (destination === ":memory:") {
    throw new Error("备份目标不能是内存数据库")
  }
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

  // 在父目录内创建仅当前用户可访问的随机目录。SQLite 先写入临时文件，
  // 完整性校验通过后再用 link(2) 发布；link 不会跟随目标符号链接，且
  // 目标已存在时原子失败，从而避免“检查后写入”的 TOCTOU 窗口。
  const stagingDirectory = await mkdtemp(
    join(dirname(destination), `.${basename(destination)}.tmp-`)
  )
  const stagingPath = join(stagingDirectory, basename(destination))
  try {
    const metadata = await db.backup(stagingPath)
    const created = await lstat(stagingPath)
    if (!created.isFile() || created.isSymbolicLink()) {
      throw new Error("备份目标不是普通文件")
    }
    await chmod(stagingPath, 0o600)
    const integrity = verifyDatabaseFile(stagingPath)
    if (!integrity.ok) {
      throw new Error(`备份完整性检查失败：${integrity.messages.join("；")}`)
    }
    try {
      await link(stagingPath, destination)
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : ""
      if (code === "EEXIST") {
        throw new Error(`备份目标已存在：${destination}`)
      }
      throw error
    }
    return {
      path: destination,
      userVersion: readUserVersion(db),
      totalPages: metadata.totalPages,
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(
      () => undefined
    )
  }
}
