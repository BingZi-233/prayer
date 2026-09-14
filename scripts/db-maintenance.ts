import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { backupDatabase, verifyDatabaseFile } from "../lib/core/db/backup.ts"
import {
  canonicalDbPath,
  databaseOpenPath,
} from "../lib/core/db/path.ts"
import {
  applyRetention,
  applyTranscriptRetention,
  DEFAULT_RETENTION_POLICY,
  inspectRetention,
  inspectTranscriptRetention,
} from "../lib/core/db/retention.ts"

function sourcePath(value?: string): string {
  return canonicalDbPath(value ?? process.env.DB_PATH ?? "./data/agent.db")
}

function defaultBackupPath(source: string): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-")
  return `${databaseOpenPath(source)}.${timestamp}.bak`
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = args.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = args.indexOf(`--${name}`)
  const value = index >= 0 ? args[index + 1] : undefined
  return value && !value.startsWith("--") ? value : undefined
}

function parseNow(args: readonly string[]): number {
  const value = flagValue(args, "now")
  if (value == null) return Date.now()
  const now = Number(value)
  if (!Number.isFinite(now)) throw new Error("--now 必须是有限数字")
  return now
}

function retentionPositionals(args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--transcripts" || arg === "--now") {
      const value = args[++i]
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要一个值`)
      continue
    }
    if (!arg.startsWith("--")) out.push(arg)
  }
  return out
}

function assertCompleteReport(
  report: ReturnType<typeof inspectRetention>
): void {
  const missing = report.tables
    .filter((row) => !row.available)
    .map((row) => row.table)
  if (missing.length) throw new Error(`数据库缺少保留表：${missing.join(", ")}`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const [command, sourceArg, destinationArg] = args
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
    const db = new Database(databaseOpenPath(source), { fileMustExist: true })
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

  if (command === "retention") {
    const positional = retentionPositionals(args)
    const dbPath = sourcePath(positional[0])
    const apply = args.includes("--apply")
    const deleteTranscripts = args.includes("--delete-transcripts")
    const transcriptRoot = flagValue(args, "transcripts")
    if (deleteTranscripts && !apply)
      throw new Error("删除 transcript 必须同时显式传入 --apply")
    if (deleteTranscripts && !transcriptRoot)
      throw new Error(
        "--delete-transcripts 需要 --transcripts=/path/to/projects"
      )

    const now = parseNow(args)
    // Dry-run must not even open a writable handle; this keeps the default
    // report safe while the service is still running.
    const db = new Database(databaseOpenPath(dbPath), {
      fileMustExist: true,
      readonly: !apply,
    })
    try {
      sqliteVec.load(db)
      const before = inspectRetention(db, now, DEFAULT_RETENTION_POLICY)
      assertCompleteReport(before)
      const transcriptBefore = transcriptRoot
        ? inspectTranscriptRetention(
            transcriptRoot,
            now,
            DEFAULT_RETENTION_POLICY.transcriptsDays
          )
        : undefined
      if (deleteTranscripts && !transcriptBefore?.available)
        throw new Error("transcript 根目录不存在或不可读，已拒绝删除")

      const database = apply
        ? applyRetention(db, now, DEFAULT_RETENTION_POLICY)
        : undefined
      const transcripts = deleteTranscripts
        ? applyTranscriptRetention(
            transcriptRoot!,
            now,
            DEFAULT_RETENTION_POLICY.transcriptsDays
          )
        : undefined
      console.log(
        JSON.stringify(
          {
            apply,
            source: dbPath,
            policy: DEFAULT_RETENTION_POLICY,
            database: database ?? { before },
            transcripts: transcripts ?? transcriptBefore ?? null,
          },
          null,
          2
        )
      )
    } finally {
      db.close()
    }
    return
  }

  throw new Error(
    "用法：pnpm db:check [数据库路径]；pnpm db:backup [数据库路径] [备份路径]；pnpm db:retention [数据库路径] [--apply] [--transcripts=/path/to/projects --delete-transcripts]"
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
