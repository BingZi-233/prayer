import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { resolve } from "node:path"
import { backupDatabase, verifyDatabaseFile } from "../lib/core/db/backup.ts"

function sourcePath(value?: string): string {
  return resolve(value ?? process.env.DB_PATH ?? "./data/agent.db")
}

function defaultBackupPath(source: string): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-")
  return `${source}.${timestamp}.bak`
}

async function main(): Promise<void> {
  const [command, sourceArg, destinationArg] = process.argv.slice(2)
  const source = sourcePath(sourceArg)

  if (command === "check") {
    const result = verifyDatabaseFile(source)
    if (!result.ok) {
      throw new Error(`数据库完整性检查失败：${result.messages.join("；")}`)
    }
    console.log(`数据库完整性检查通过：${source}`)
    return
  }

  if (command === "backup") {
    const db = new Database(source, { fileMustExist: true })
    try {
      sqliteVec.load(db)
      const result = await backupDatabase(
        db,
        destinationArg ?? defaultBackupPath(source)
      )
      console.log(
        `数据库备份完成：${result.path}（schema v${result.userVersion}，${result.totalPages} 页）`
      )
    } finally {
      db.close()
    }
    return
  }

  throw new Error(
    "用法：pnpm db:check [数据库路径]；pnpm db:backup [数据库路径] [备份路径]"
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
