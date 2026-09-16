import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  createAdminAuditCompletion,
  createAdminAuditStart,
} from "@/lib/core/admin-audit"

const { getAppContextMock } = vi.hoisted(() => ({
  getAppContextMock: vi.fn(),
}))

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: getAppContextMock,
}))

import { GET } from "@/app/api/audit/route"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"

let db: ReturnType<typeof openDb>
let repo: Repo

function addEvent(
  action: string,
  route: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  startedAt: number,
  completed = false
): number {
  const id = repo.adminAudit.begin(
    createAdminAuditStart({ action, route, method }, startedAt, true)
  )
  if (completed)
    repo.adminAudit.finish(
      id,
      createAdminAuditCompletion(200, startedAt + 1, {
        detail: { changed_count: 1 },
      })
    )
  return id
}

beforeEach(() => {
  vi.clearAllMocks()
  db = openDb(":memory:", 3)
  repo = new Repo(db)
  getAppContextMock.mockReturnValue({ repo })
})

afterEach(() => {
  vi.restoreAllMocks()
  db.close()
})

describe("GET /api/audit", () => {
  it("returns bounded operational summaries and the full unfinished count", async () => {
    addEvent("kb.create", "/api/kb", "POST", 100, true)
    addEvent("kb.update", "/api/kb/[...file]", "PUT", 200)
    const newestUnfinished = addEvent(
      "kb.delete",
      "/api/kb/[...file]",
      "DELETE",
      300
    )
    const newestCompleted = addEvent(
      "kb.ingest",
      "/api/kb/ingest",
      "POST",
      400,
      true
    )
    const completed = repo.adminAudit.get(newestCompleted)!
    const unfinished = repo.adminAudit.get(newestUnfinished)!

    const response = await GET(new NextRequest("http://x/api/audit?limit=1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: {
        limit: 1,
        recent: [
          {
            id: newestCompleted,
            requestId: completed.requestId,
            actorType: "shared-admin-token",
            action: "kb.ingest",
            route: "/api/kb/ingest",
            method: "POST",
            result: "accepted",
            httpStatus: 200,
            detail: { changed_count: 1 },
            startedAt: 400,
            finishedAt: 401,
          },
        ],
        unfinished: [
          {
            id: newestUnfinished,
            requestId: unfinished.requestId,
            actorType: "shared-admin-token",
            action: "kb.delete",
            route: "/api/kb/[...file]",
            method: "DELETE",
            result: "started",
            httpStatus: null,
            detail: {},
            startedAt: 300,
            finishedAt: null,
          },
        ],
        unfinishedCount: 2,
      },
    })
    expect(body.data.recent[0]).toMatchObject({
      requestId: completed.requestId,
      actorType: "shared-admin-token",
    })
  })

  it("uses the established 100-record default limit", async () => {
    addEvent("kb.create", "/api/kb", "POST", 100, true)
    const recent = vi.spyOn(repo.adminAudit, "recent")
    const unfinished = vi.spyOn(repo.adminAudit, "unfinished")

    const response = await GET(new NextRequest("http://x/api/audit"))

    expect(response.status).toBe(200)
    expect(recent).toHaveBeenCalledWith(100)
    expect(unfinished).toHaveBeenCalledWith(100)
  })

  it("rejects malformed, duplicated, or out-of-range limits before reading", async () => {
    const recent = vi.spyOn(repo.adminAudit, "recent")
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=1e2",
      "limit=1&limit=2",
    ]) {
      const response = await GET(new NextRequest(`http://x/api/audit?${query}`))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        ok: false,
        error: "limit 参数必须是 1 到 100 的整数",
      })
    }
    expect(recent).not.toHaveBeenCalled()
  })

  it("returns a generic read failure without exposing the underlying error", async () => {
    const secret = "request-body-and-error-content"
    vi.spyOn(repo.adminAudit, "recent").mockImplementation(() => {
      throw new Error(secret)
    })

    const response = await GET(new NextRequest("http://x/api/audit"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false, error: "审计读取失败" })
    expect(JSON.stringify(body)).not.toContain(secret)
  })
})
