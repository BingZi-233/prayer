import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import {
  backupDatabase,
  checkDatabaseIntegrity,
  verifyDatabaseFile,
} from "../lib/core/db/backup.ts"
import { canonicalDbPath, databaseOpenPath } from "../lib/core/db/path.ts"
import { Repo } from "../lib/core/db/repo.ts"
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

/**
 * 供外部监控调用的只读快照。这里不能使用 openDb/getAppContext：它们会执行
 * WAL 设置、迁移或配置 seed；调用者必须传入 readonly 打开的数据库。
 */
export function inspectDatabaseReport(db: Database.Database, now = Date.now()) {
  const retention = inspectRetention(db, now, DEFAULT_RETENTION_POLICY)
  const complete = retention.tables.every((table) => table.available)
  return {
    checkedAt: now,
    integrity: checkDatabaseIntegrity(db),
    retention,
    // 部分库缺表时保留诊断而不是让 statusCounts 掩盖根因。
    outbox: complete ? new Repo(db).outbox.statusCounts() : null,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const [command, sourceArg, destinationArg] = args

  if (command === "check") {
    const source = sourcePath(sourceArg)
    const result = verifyDatabaseFile(source)
    if (!result.ok) {
      throw new Error(`数据库完整性检查失败：${result.messages.join("；")}`)
    }
    console.log(`数据库完整性检查通过：${source}`)
    return
  }

  if (command === "report") {
    const positional = retentionPositionals(args)
    const dbPath = sourcePath(positional[0])
    // 报告命令刻意不走 openDb：不得触发迁移/WAL 设置，也不得创建备份或删除数据。
    const db = new Database(databaseOpenPath(dbPath), {
      fileMustExist: true,
      readonly: true,
    })
    try {
      sqliteVec.load(db)
      const report = inspectDatabaseReport(db, parseNow(args))
      const schemaComplete = report.retention.tables.every(
        (table) => table.available
      )
      const ok = report.integrity.ok && schemaComplete
      console.log(
        JSON.stringify(
          {
            ok,
            source: dbPath,
            ...report,
          },
          null,
          2
        )
      )
      // 保留候选是人工确认的正常运营信号，不把它误报为失败。
      if (!ok) process.exitCode = 1
    } finally {
      db.close()
    }
    return
  }

  if (command === "backup") {
    const source = sourcePath(sourceArg)
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
    "用法：pnpm db:check [数据库路径]；pnpm db:report [数据库路径]；pnpm db:backup [数据库路径] [备份路径]；pnpm db:retention [数据库路径] [--apply] [--transcripts=/path/to/projects --delete-transcripts]"
  )
}

if (process.argv[1]?.endsWith("db-maintenance.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
