import { NextResponse } from "next/server"
import {
  createAdminAuditCompletion,
  createAdminAuditStart,
  type AdminAuditDescriptor,
} from "./admin-audit"
import { fail } from "./api"
import type { Repo } from "./db/repo"
import { logger } from "./logger"

/** A server-generated identifier for looking up the corresponding audit row. */
export const ADMIN_AUDIT_REQUEST_ID_HEADER = "x-request-id"

type AuditRepo = Pick<Repo, "adminAudit">

function withRequestId(
  response: NextResponse,
  requestId: string
): NextResponse {
  response.headers.set(ADMIN_AUDIT_REQUEST_ID_HEADER, requestId)
  return response
}

function logAuditFailure(
  scope: "admin-audit.begin" | "admin-audit.mutation" | "admin-audit.finish",
  msg: string
): void {
  try {
    logger.error(msg, { scope })
  } catch {
    // A diagnostic must not change the mutation or audit recovery behavior.
  }
}

/**
 * Wrap a validated admin mutation after proxy authorization and before its
 * first side effect. A terminal record is only a statement about the returned
 * HTTP status, not an atomic claim about files, processes, or remote systems.
 */
export async function withAdminMutationAudit(
  repo: AuditRepo,
  descriptor: AdminAuditDescriptor,
  mutate: () => Promise<NextResponse> | NextResponse
): Promise<NextResponse> {
  const entry = createAdminAuditStart(
    descriptor,
    Date.now(),
    Boolean(process.env.ADMIN_TOKEN)
  )
  let auditId: number
  try {
    auditId = repo.adminAudit.begin(entry)
  } catch {
    logAuditFailure(
      "admin-audit.begin",
      "[admin-audit] start persistence failed"
    )
    return withRequestId(
      NextResponse.json(fail("审计服务暂不可用，本次变更未执行"), {
        status: 503,
      }),
      entry.requestId
    )
  }

  let response: NextResponse
  try {
    response = await mutate()
  } catch {
    // Preserve `started`: a crash can happen after an external side effect.
    logAuditFailure(
      "admin-audit.mutation",
      "[admin-audit] mutation interrupted after start"
    )
    return withRequestId(
      NextResponse.json(fail("管理变更执行异常，请查看服务日志"), {
        status: 500,
      }),
      entry.requestId
    )
  }

  try {
    const finished = repo.adminAudit.finish(
      auditId,
      createAdminAuditCompletion(response.status, Date.now())
    )
    if (!finished)
      logAuditFailure(
        "admin-audit.finish",
        "[admin-audit] terminal record was not updated"
      )
  } catch {
    // Preserve `started` when the terminal write is unavailable.
    logAuditFailure(
      "admin-audit.finish",
      "[admin-audit] terminal persistence failed"
    )
  }
  return withRequestId(response, entry.requestId)
}
