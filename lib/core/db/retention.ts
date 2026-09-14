import type Database from "better-sqlite3"
import { lstatSync, readdirSync, realpathSync, unlinkSync } from "node:fs"
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path"

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Conservative defaults for data that is only used by the admin views or
 * background reports. The maintenance command is dry-run by default.
 */
export const DEFAULT_RETENTION_POLICY = Object.freeze({
  reflectCompactionsDays: 180,
  questionOccurrencesDays: 365,
  questionTopicsDays: 365,
  usageDays: 730,
  sessionsDays: 365,
  outboxSentDays: 90,
  transcriptsDays: 90,
})

export type RetentionPolicy = Readonly<{
  reflectCompactionsDays: number
  questionOccurrencesDays: number
  questionTopicsDays: number
  usageDays: number
  sessionsDays: number
  outboxSentDays: number
  transcriptsDays: number
}>

export type RetentionTableReport = Readonly<{
  table: string
  available: boolean
  cutoff: number | string
  candidates: number
  protected?: number
  detail?: string
}>

export type RetentionReport = Readonly<{
  now: number
  policy: RetentionPolicy
  tables: RetentionTableReport[]
  totalCandidates: number
}>

export type TranscriptRetentionReport = Readonly<{
  root: string
  available: boolean
  cutoff: number
  files: number
  bytes: number
  candidates: number
  candidateBytes: number
  errors: number
}>

export type RetentionApplyResult = Readonly<{
  before: RetentionReport
  deleted: Record<string, number>
  after: RetentionReport
}>

export type TranscriptRetentionApplyResult = Readonly<{
  before: TranscriptRetentionReport
  deleted: number
  deletedBytes: number
  after: TranscriptRetentionReport
}>

type TableSpec = Readonly<{
  table: string
  requires?: readonly string[]
  cutoff: (now: number, policy: RetentionPolicy) => number | string
  countSql: string
  deleteSql: string
  args: (
    cutoff: number | string,
    now: number,
    policy: RetentionPolicy
  ) => unknown[]
  detail?: string
}>

const tableExists = (db: Database.Database, table: string): boolean =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  )

const daysAgo = (now: number, days: number): number => now - days * DAY_MS

const utcDay = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

function validateClock(now: number): void {
  if (!Number.isFinite(now)) throw new Error("保留检查时间必须是有限数字")
}

function validateDays(value: number, name: string): void {
  // A bounded integer keeps a typo from turning a cleanup into a future-row
  // delete. One hundred years is well beyond any supported audit window.
  if (!Number.isInteger(value) || value < 1 || value > 36_500)
    throw new Error(`${name} 必须是 1 到 36500 之间的整数`)
}

function validatePolicy(policy: RetentionPolicy): void {
  validateDays(policy.reflectCompactionsDays, "reflectCompactionsDays")
  validateDays(policy.questionOccurrencesDays, "questionOccurrencesDays")
  validateDays(policy.questionTopicsDays, "questionTopicsDays")
  validateDays(policy.usageDays, "usageDays")
  validateDays(policy.sessionsDays, "sessionsDays")
  validateDays(policy.outboxSentDays, "outboxSentDays")
  validateDays(policy.transcriptsDays, "transcriptsDays")
}

const TABLES: readonly TableSpec[] = [
  {
    table: "reflect_compactions",
    cutoff: (now, policy) => daysAgo(now, policy.reflectCompactionsDays),
    countSql: "SELECT COUNT(*) AS n FROM reflect_compactions WHERE ts < ?",
    deleteSql: "DELETE FROM reflect_compactions WHERE ts < ?",
    args: (cutoff) => [cutoff],
    detail: "保留整理快照，避免大 JSON 长期占用数据库",
  },
  {
    table: "question_occurrences",
    cutoff: (now, policy) => daysAgo(now, policy.questionOccurrencesDays),
    countSql: "SELECT COUNT(*) AS n FROM question_occurrences WHERE msg_ts < ?",
    deleteSql: "DELETE FROM question_occurrences WHERE msg_ts < ?",
    args: (cutoff) => [cutoff],
    detail: "主题排行的原始出现记录",
  },
  {
    table: "question_topics",
    cutoff: (now, policy) => daysAgo(now, policy.questionTopicsDays),
    countSql:
      "SELECT COUNT(*) AS n FROM question_topics t WHERE t.updated_at < ? AND NOT EXISTS (SELECT 1 FROM question_occurrences o WHERE o.topic_id = t.id AND o.msg_ts >= ?)",
    deleteSql:
      "DELETE FROM question_topics WHERE updated_at < ? AND NOT EXISTS (SELECT 1 FROM question_occurrences o WHERE o.topic_id = question_topics.id AND o.msg_ts >= ?)",
    requires: ["question_occurrences"],
    args: (cutoff, now, policy) => [
      cutoff,
      daysAgo(now, policy.questionOccurrencesDays),
    ],
    detail: "仅删除过期且已无出现记录的孤立主题",
  },
  {
    table: "usage_daily",
    cutoff: (now, policy) => utcDay(daysAgo(now, policy.usageDays)),
    countSql: "SELECT COUNT(*) AS n FROM usage_daily WHERE day < ?",
    deleteSql: "DELETE FROM usage_daily WHERE day < ?",
    args: (cutoff) => [cutoff],
    detail: "按 UTC 日聚合的模型用量",
  },
  {
    table: "tool_stats_daily",
    cutoff: (now, policy) => utcDay(daysAgo(now, policy.usageDays)),
    countSql: "SELECT COUNT(*) AS n FROM tool_stats_daily WHERE day < ?",
    deleteSql: "DELETE FROM tool_stats_daily WHERE day < ?",
    args: (cutoff) => [cutoff],
    detail: "按 UTC 日聚合的工具用量",
  },
  {
    table: "outbox_messages",
    cutoff: (now, policy) => daysAgo(now, policy.outboxSentDays),
    countSql:
      "SELECT COUNT(*) AS n FROM outbox_messages WHERE status = 'sent' AND sent_at IS NOT NULL AND sent_at < ?",
    deleteSql:
      "DELETE FROM outbox_messages WHERE status = 'sent' AND sent_at IS NOT NULL AND sent_at < ?",
    args: (cutoff) => [cutoff],
    detail:
      "仅清理超过窗口的已成功投递记录；pending、sending、failed 记录保留以便重试和排障",
  },
]

function sessionSpec(
  db: Database.Database,
  now: number,
  policy: RetentionPolicy
): TableRetentionPlan | null {
  // Both tables are referenced by the candidate predicate.  Returning a plan
  // when `sessions` is absent would make the read-only report look partial and
  // make applyRetention throw halfway through a maintenance run.
  if (!tableExists(db, "tickets") || !tableExists(db, "sessions")) return null
  const cutoff = daysAgo(now, policy.sessionsDays)
  const where =
    // tickets 没有 FK/cascade；保护任何历史工单，避免删会话后留下孤儿工单。
    "updated_at < ? AND human_mode = 0 AND resume_id IS NULL AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.session_key = sessions.key)"
  return {
    table: "sessions",
    cutoff,
    countSql: `SELECT COUNT(*) AS n FROM sessions WHERE ${where}`,
    deleteSql: `DELETE FROM sessions WHERE ${where}`,
    args: [cutoff],
    detail:
      "仅删除过期、非人工、无续接指针且没有任何工单的会话；其余旧会话受保护",
  }
}

type TableRetentionPlan = Readonly<{
  table: string
  cutoff: number | string
  countSql: string
  deleteSql: string
  args: unknown[]
  detail?: string
}>

function readCount(
  db: Database.Database,
  sql: string,
  args: readonly unknown[]
): number {
  const statement = db.prepare(sql)
  const row = Reflect.apply(statement.get, statement, args) as
    { n?: unknown } | undefined
  return Number(row?.n ?? 0)
}

function plans(
  db: Database.Database,
  now: number,
  policy: RetentionPolicy
): TableRetentionPlan[] {
  const out: TableRetentionPlan[] = []
  for (const spec of TABLES) {
    if (
      !tableExists(db, spec.table) ||
      spec.requires?.some((table) => !tableExists(db, table))
    )
      continue
    const cutoff = spec.cutoff(now, policy)
    out.push({
      table: spec.table,
      cutoff,
      countSql: spec.countSql,
      deleteSql: spec.deleteSql,
      args: spec.args(cutoff, now, policy),
      detail: spec.detail,
    })
  }
  const session = sessionSpec(db, now, policy)
  if (session) out.push(session)
  return out
}

export function inspectRetention(
  db: Database.Database,
  now = Date.now(),
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY
): RetentionReport {
  validateClock(now)
  validatePolicy(policy)
  const tables: RetentionTableReport[] = []
  for (const plan of plans(db, now, policy)) {
    const candidates = readCount(db, plan.countSql, plan.args)
    const old =
      plan.table === "sessions"
        ? readCount(
            db,
            "SELECT COUNT(*) AS n FROM sessions WHERE updated_at < ?",
            [plan.cutoff]
          )
        : candidates
    tables.push({
      table: plan.table,
      available: true,
      cutoff: plan.cutoff,
      candidates,
      ...(plan.table === "sessions"
        ? { protected: Math.max(0, old - candidates) }
        : {}),
      detail: plan.detail,
    })
  }
  // Missing tables are reported explicitly so an old/partial database cannot
  // look clean merely because a query was skipped.
  for (const table of [...TABLES.map((spec) => spec.table), "sessions"]) {
    if (tables.some((row) => row.table === table)) continue
    const spec = TABLES.find((item) => item.table === table)
    const cutoff =
      table === "sessions"
        ? daysAgo(now, policy.sessionsDays)
        : (spec?.cutoff(now, policy) ?? now)
    tables.push({
      table,
      available: false,
      cutoff,
      candidates: 0,
      detail: "表不存在，未执行清理",
    })
  }
  return {
    now,
    policy,
    tables,
    totalCandidates: tables.reduce((sum, row) => sum + row.candidates, 0),
  }
}

export function applyRetention(
  db: Database.Database,
  now = Date.now(),
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY
): RetentionApplyResult {
  validateClock(now)
  validatePolicy(policy)
  const before = inspectRetention(db, now, policy)
  // Cleanup is intentionally all-or-nothing.  A partial/old database must be
  // repaired or migrated first; silently deleting the tables that happen to
  // exist would make the retention report impossible to audit.
  const missing = before.tables
    .filter((table) => !table.available)
    .map((table) => table.table)
  if (missing.length > 0)
    throw new Error(`保留清理需要完整数据库；缺少表: ${missing.join(", ")}`)
  const deleted: Record<string, number> = {}
  const run = db.transaction(() => {
    for (const plan of plans(db, now, policy)) {
      const info = db.prepare(plan.deleteSql).run(...plan.args)
      deleted[plan.table] = Number(info.changes)
    }
  })
  run()
  return { before, deleted, after: inspectRetention(db, now, policy) }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return (
    rel !== "" &&
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`)
  )
}

function allowedSystemAlias(path: string, target: string): boolean {
  // macOS exposes these stable OS aliases on many developer machines. They
  // are not operator-selected transcript links; accepting only these exact
  // mappings keeps normal tmpdir paths usable without allowing arbitrary
  // intermediate symlinks.
  if (process.platform !== "darwin") return false
  return (
    (path === "/tmp" && target === "/private/tmp") ||
    (path === "/var" && target === "/private/var")
  )
}

/** Resolve an explicitly supplied directory without following a symlink root. */
function safeTranscriptRoot(rootInput: string): string | null {
  const lexical = resolve(rootInput)
  try {
    // lstat-ing only the final directory is insufficient: an intermediate
    // component can be a symlink to an unrelated tree while the final path
    // itself looks like an ordinary directory. Walk every existing component
    // and fail closed before realpath/readdir can follow one.
    const root = parse(lexical).root
    if (lexical === root) return null
    let current = root
    for (const part of relative(root, lexical).split(sep)) {
      if (!part) continue
      current = join(current, part)
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) {
        const target = realpathSync(current)
        if (!allowedSystemAlias(current, target)) return null
      }
    }
    const stat = lstatSync(lexical)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null
    return realpathSync(lexical)
  } catch {
    return null
  }
}

type TranscriptScan = {
  files: number
  bytes: number
  candidates: number
  candidateBytes: number
  errors: number
  paths: { path: string; bytes: number }[]
}

function scanTranscripts(rootInput: string, cutoff: number): TranscriptScan {
  const root = safeTranscriptRoot(rootInput)
  if (!root) {
    return {
      files: 0,
      bytes: 0,
      candidates: 0,
      candidateBytes: 0,
      errors: 1,
      paths: [],
    }
  }
  const stack = [root]
  const paths: { path: string; bytes: number }[] = []
  let files = 0
  let bytes = 0
  let candidates = 0
  let candidateBytes = 0
  let errors = 0
  while (stack.length) {
    const dir = stack.pop()!
    try {
      const canonicalDir = realpathSync(dir)
      if (canonicalDir !== dir) {
        errors++
        continue
      }
    } catch {
      errors++
      continue
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      errors++
      continue
    }
    for (const entry of entries) {
      const path = resolve(dir, entry.name)
      if (!inside(root, path)) {
        errors++
        continue
      }
      let stat
      try {
        stat = lstatSync(path)
      } catch {
        errors++
        continue
      }
      if (stat.isSymbolicLink()) {
        errors++
        continue
      }
      try {
        const canonical = realpathSync(path)
        const withinRoot = canonical === root || inside(root, canonical)
        if (canonical !== path || !withinRoot) {
          errors++
          continue
        }
      } catch {
        errors++
        continue
      }
      if (stat.isDirectory()) {
        stack.push(path)
        continue
      }
      if (!stat.isFile() || !entry.name.endsWith(".jsonl")) continue
      files++
      bytes += stat.size
      if (stat.mtimeMs < cutoff) {
        candidates++
        candidateBytes += stat.size
        paths.push({ path, bytes: stat.size })
      }
    }
  }
  return { files, bytes, candidates, candidateBytes, errors, paths }
}

export function inspectTranscriptRetention(
  root: string,
  now = Date.now(),
  retentionDays: number = DEFAULT_RETENTION_POLICY.transcriptsDays
): TranscriptRetentionReport {
  validateClock(now)
  validateDays(retentionDays, "transcriptsDays")
  const cutoff = daysAgo(now, retentionDays)
  const scan = scanTranscripts(root, cutoff)
  const canonicalRoot = safeTranscriptRoot(root)
  return {
    root: canonicalRoot ?? resolve(root),
    // Partial scans are not safe for deletion: an unreadable directory or a
    // symlink may hide files that the operator believes were retained.
    available: canonicalRoot !== null && scan.errors === 0,
    cutoff,
    files: scan.files,
    bytes: scan.bytes,
    candidates: scan.candidates,
    candidateBytes: scan.candidateBytes,
    errors: scan.errors,
  }
}

/** Delete only old regular JSONL files under the explicitly supplied root. */
export function applyTranscriptRetention(
  root: string,
  now = Date.now(),
  retentionDays: number = DEFAULT_RETENTION_POLICY.transcriptsDays
): TranscriptRetentionApplyResult {
  validateClock(now)
  validateDays(retentionDays, "transcriptsDays")
  const before = inspectTranscriptRetention(root, now, retentionDays)
  if (!before.available) {
    return { before, deleted: 0, deletedBytes: 0, after: before }
  }
  const cutoff = before.cutoff
  let deleted = 0
  let deletedBytes = 0
  let realRoot: string
  try {
    realRoot = safeTranscriptRoot(root) ?? ""
    if (!realRoot) throw new Error("unsafe transcript root")
  } catch {
    return { before, deleted, deletedBytes, after: before }
  }
  const scan = scanTranscripts(realRoot, cutoff)
  if (scan.errors > 0) {
    const after = inspectTranscriptRetention(realRoot, now, retentionDays)
    return { before, deleted: 0, deletedBytes: 0, after }
  }
  for (const candidate of scan.paths) {
    try {
      const stat = lstatSync(candidate.path)
      const canonical = realpathSync(candidate.path)
      if (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.mtimeMs < cutoff &&
        inside(realRoot, canonical)
      ) {
        unlinkSync(candidate.path)
        deleted++
        deletedBytes += stat.size
      }
    } catch {
      // A concurrent rotation/removal is harmless; the post-scan reports it.
    }
  }
  return {
    before,
    deleted,
    deletedBytes,
    after: inspectTranscriptRetention(realRoot, now, retentionDays),
  }
}
