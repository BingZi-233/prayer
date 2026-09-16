import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
import { isAdminAuditRequestId } from "@/lib/core/admin-audit"
import {
  ADMIN_AUDIT_REQUEST_ID_HEADER,
  withAdminMutationAudit,
} from "@/lib/core/admin-audit-route"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"
import { logger } from "@/lib/core/logger"

let db: ReturnType<typeof openDb>
let repo: Repo

const descriptor = {
  action: "sessions.reset",
  route: "/api/sessions",
  method: "POST" as const,
}

function requestId(response: NextResponse): string {
  const value = response.headers.get(ADMIN_AUDIT_REQUEST_ID_HEADER)
  expect(isAdminAuditRequestId(value)).toBe(true)
  return value!
}

describe("admin mutation route audit", () => {
  beforeEach(() => {
    db = openDb(":memory:", 3)
    repo = new Repo(db)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it("fails closed before the mutation when the start write fails", async () => {
    const mutate = vi.fn(() => NextResponse.json({ ok: true }))
    const logError = vi.spyOn(logger, "error")
    vi.spyOn(repo.adminAudit, "begin").mockImplementation(() => {
      throw new Error("sqlite unavailable")
    })

    const response = await withAdminMutationAudit(repo, descriptor, mutate)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      error: "审计服务暂不可用，本次变更未执行",
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(repo.adminAudit.recent()).toEqual([])
    expect(logError).toHaveBeenCalledWith(
      "[admin-audit] start persistence failed",
      { scope: "admin-audit.begin" }
    )
    requestId(response)
  })

  it("returns the mutation response but leaves started when finish throws", async () => {
    vi.spyOn(repo.adminAudit, "finish").mockImplementation(() => {
      throw new Error("audit finalize unavailable")
    })
    const logError = vi.spyOn(logger, "error")

    const response = await withAdminMutationAudit(repo, descriptor, () =>
      NextResponse.json({ ok: true })
    )
    const event = repo.adminAudit.getByRequestId(requestId(response))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(event).toMatchObject({ result: "started", httpStatus: null })
    expect(logError).toHaveBeenCalledWith(
      "[admin-audit] terminal persistence failed",
      { scope: "admin-audit.finish" }
    )
  })

  it("logs a false terminal write while leaving started", async () => {
    vi.spyOn(repo.adminAudit, "finish").mockReturnValue(false)
    const logError = vi.spyOn(logger, "error")

    const response = await withAdminMutationAudit(repo, descriptor, () =>
      NextResponse.json({ ok: true })
    )
    const event = repo.adminAudit.getByRequestId(requestId(response))

    expect(event).toMatchObject({ result: "started", httpStatus: null })
    expect(logError).toHaveBeenCalledWith(
      "[admin-audit] terminal record was not updated",
      { scope: "admin-audit.finish" }
    )
  })

  it("leaves started after an unhandled mutation exception without leaking it", async () => {
    const logError = vi.spyOn(logger, "error")
    const response = await withAdminMutationAudit(repo, descriptor, () => {
      throw new Error("token=secret")
    })
    const event = repo.adminAudit.getByRequestId(requestId(response))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: "管理变更执行异常，请查看服务日志",
    })
    expect(event).toMatchObject({ result: "started", httpStatus: null })
    expect(logError).toHaveBeenCalledWith(
      "[admin-audit] mutation interrupted after start",
      { scope: "admin-audit.mutation" }
    )
  })

  it("maps a returned rejection to a terminal audit result", async () => {
    const response = await withAdminMutationAudit(repo, descriptor, () =>
      NextResponse.json({ ok: false }, { status: 409 })
    )
    const event = repo.adminAudit.getByRequestId(requestId(response))

    expect(event).toMatchObject({ result: "rejected", httpStatus: 409 })
  })
})
