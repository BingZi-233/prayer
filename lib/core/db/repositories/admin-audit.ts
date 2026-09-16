import {
  assertAdminAuditCompletion,
  assertAdminAuditStart,
  isAdminAuditRequestId,
  normalizeAdminAuditDetail,
  type AdminAuditCompletion,
  type AdminAuditDetail,
  type AdminAuditResult,
  type AdminAuditStart,
} from "../../admin-audit.ts"
import type { SqliteContext } from "../context.ts"

type AdminAuditRow = {
  id: number
  request_id: string
  actor_type: AdminAuditStart["actorType"]
  action: string
  route: string
  method: AdminAuditStart["method"]
  result: AdminAuditResult
  http_status: number | null
  detail_json: string
  started_at: number
  finished_at: number | null
}

export type AdminAuditEvent = Readonly<{
  id: number
  requestId: string
  actorType: AdminAuditStart["actorType"]
  action: string
  route: string
  method: AdminAuditStart["method"]
  result: AdminAuditResult
  httpStatus: number | null
  detail: AdminAuditDetail
  startedAt: number
  finishedAt: number | null
}>

function mapEvent(row: AdminAuditRow): AdminAuditEvent {
  let rawDetail: unknown
  try {
    rawDetail = JSON.parse(row.detail_json)
  } catch {
    throw new Error(`管理审计记录 ${row.id} 的详情损坏`)
  }
  return {
    id: row.id,
    requestId: row.request_id,
    actorType: row.actor_type,
    action: row.action,
    route: row.route,
    method: row.method,
    result: row.result,
    httpStatus: row.http_status,
    detail: normalizeAdminAuditDetail(rawDetail),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

/**
 * Persistent operational trail for validated admin mutations. It is not a
 * human-identity or tamper-proof compliance log.
 */
export class AdminAuditRepository {
  constructor(private readonly sql: SqliteContext) {}

  begin(entry: AdminAuditStart): number {
    assertAdminAuditStart(entry)
    const info = this.sql
      .prepare(
        `INSERT INTO admin_audit_events
          (request_id, actor_type, action, route, method, result, started_at)
         VALUES (?, ?, ?, ?, ?, 'started', ?)`
      )
      .run(
        entry.requestId,
        entry.actorType,
        entry.action,
        entry.route,
        entry.method,
        entry.startedAt
      )
    return Number(info.lastInsertRowid)
  }

  finish(id: number, completion: AdminAuditCompletion): boolean {
    if (!Number.isSafeInteger(id) || id < 1)
      throw new RangeError("管理审计记录 id 非法")
    assertAdminAuditCompletion(completion)
    const info = this.sql
      .prepare(
        `UPDATE admin_audit_events
         SET result = ?, http_status = ?, detail_json = ?, finished_at = ?
         WHERE id = ? AND result = 'started' AND http_status IS NULL AND finished_at IS NULL`
      )
      .run(
        completion.result,
        completion.httpStatus,
        JSON.stringify(normalizeAdminAuditDetail(completion.detail)),
        completion.finishedAt,
        id
      )
    return info.changes > 0
  }

  get(id: number): AdminAuditEvent | undefined {
    if (!Number.isSafeInteger(id) || id < 1)
      throw new RangeError("管理审计记录 id 非法")
    const row = this.sql
      .prepare<AdminAuditRow>(
        `SELECT id, request_id, actor_type, action, route, method, result,
                http_status, detail_json, started_at, finished_at
         FROM admin_audit_events WHERE id = ?`
      )
      .get(id)
    return row ? mapEvent(row) : undefined
  }

  getByRequestId(requestId: string): AdminAuditEvent | undefined {
    if (!isAdminAuditRequestId(requestId))
      throw new TypeError("管理审计 request id 非法")
    const row = this.sql
      .prepare<AdminAuditRow>(
        `SELECT id, request_id, actor_type, action, route, method, result,
                http_status, detail_json, started_at, finished_at
         FROM admin_audit_events WHERE request_id = ?`
      )
      .get(requestId)
    return row ? mapEvent(row) : undefined
  }

  recent(limit = 100): readonly AdminAuditEvent[] {
    return this.sql
      .prepare<AdminAuditRow>(
        `SELECT id, request_id, actor_type, action, route, method, result,
                http_status, detail_json, started_at, finished_at
         FROM admin_audit_events
         ORDER BY started_at DESC, id DESC LIMIT ?`
      )
      .all(assertLimit(limit))
      .map(mapEvent)
  }

  unfinished(limit = 100): readonly AdminAuditEvent[] {
    return this.sql
      .prepare<AdminAuditRow>(
        `SELECT id, request_id, actor_type, action, route, method, result,
                http_status, detail_json, started_at, finished_at
         FROM admin_audit_events
         WHERE result = 'started'
         ORDER BY started_at DESC, id DESC LIMIT ?`
      )
      .all(assertLimit(limit))
      .map(mapEvent)
  }

  unfinishedCount(): number {
    return this.sql
      .prepare<{ n: number }>(
        "SELECT COUNT(*) AS n FROM admin_audit_events WHERE result = 'started'"
      )
      .get()!.n
  }
}

function assertLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500)
    throw new RangeError("管理审计查询条数必须在 1 到 500 之间")
  return value
}
