import { NextRequest, NextResponse } from "next/server"
import { fail, ok } from "@/lib/core/api"
import { getAppContext } from "@/lib/core/app-context"
import type { AdminAuditEvent } from "@/lib/core/db/repositories/admin-audit"

const DEFAULT_AUDIT_LIMIT = 100
const MAX_AUDIT_LIMIT = 100

function parseLimit(req: NextRequest): number | null {
  const values = req.nextUrl.searchParams.getAll("limit")
  if (values.length === 0) return DEFAULT_AUDIT_LIMIT
  if (values.length !== 1 || !/^[1-9]\d{0,2}$/.test(values[0])) return null
  const limit = Number(values[0])
  return Number.isSafeInteger(limit) && limit <= MAX_AUDIT_LIMIT ? limit : null
}

function summary(event: AdminAuditEvent) {
  return {
    id: event.id,
    requestId: event.requestId,
    // This is a shared-token/development authorization model, never a person.
    actorType: event.actorType,
    action: event.action,
    route: event.route,
    method: event.method,
    result: event.result,
    httpStatus: event.httpStatus,
    detail: event.detail,
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
  }
}

/**
 * Read-only operational snapshot. A shared ADMIN_TOKEN authorizes this route
 * upstream but never identifies a person. requestId is a server-generated
 * correlation UUID and actorType is only the coarse authorization model; the
 * response omits raw requests, bodies, errors, config, and user identifiers.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const limit = parseLimit(req)
  if (limit === null)
    return NextResponse.json(fail("limit 参数必须是 1 到 100 的整数"), {
      status: 400,
    })

  try {
    const { repo } = getAppContext()
    return NextResponse.json(
      ok({
        limit,
        recent: repo.adminAudit.recent(limit).map(summary),
        unfinished: repo.adminAudit.unfinished(limit).map(summary),
        unfinishedCount: repo.adminAudit.unfinishedCount(),
      })
    )
  } catch {
    return NextResponse.json(fail("审计读取失败"), { status: 500 })
  }
}
