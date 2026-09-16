import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isAdminAuditRequestId } from "@/lib/core/admin-audit"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"

const { getAppContextMock } = vi.hoisted(() => ({
  getAppContextMock: vi.fn(),
}))

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: getAppContextMock,
}))

import { PATCH } from "@/app/api/proactive/route"

let db: ReturnType<typeof openDb>
let repo: Repo

function request(body: unknown): Request {
  return new Request("http://x/api/proactive", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function expectAudit(
  response: Response,
  result: "accepted" | "rejected" | "failed",
  httpStatus: number
): void {
  const requestId = response.headers.get("x-request-id")
  expect(isAdminAuditRequestId(requestId)).toBe(true)
  expect(repo.adminAudit.getByRequestId(requestId!)).toMatchObject({
    action: "proactive.quality.update",
    route: "/api/proactive",
    method: "PATCH",
    result,
    httpStatus,
    detail: {},
  })
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

describe("PATCH /api/proactive audit", () => {
  it("records a successful quality update without storing the reply id", async () => {
    const id = repo.insertProactiveReply("qq", "100", "200", "问题", "答案")

    const response = await PATCH(request({ id, quality: "bad" }) as never)

    expect(response.status).toBe(200)
    expectAudit(response, "accepted", 200)
    expect(repo.proactiveReplies(1)[0]).toMatchObject({ id, quality: "bad" })
  })

  it("records an existing-but-missing reply as rejected", async () => {
    const response = await PATCH(request({ id: 404, quality: "ok" }) as never)

    expect(response.status).toBe(404)
    expectAudit(response, "rejected", 404)
  })

  it("records a returned database failure as failed", async () => {
    vi.spyOn(repo, "setProactiveQuality").mockImplementation(() => {
      throw new Error("database unavailable")
    })

    const response = await PATCH(request({ id: 7, quality: "ok" }) as never)

    expect(response.status).toBe(500)
    expectAudit(response, "failed", 500)
  })

  it("fails closed before the quality write when audit start cannot persist", async () => {
    const id = repo.insertProactiveReply("qq", "100", "200", "问题", "答案")
    const setQuality = vi.spyOn(repo, "setProactiveQuality")
    vi.spyOn(repo.adminAudit, "begin").mockImplementation(() => {
      throw new Error("audit unavailable")
    })

    const response = await PATCH(request({ id, quality: "bad" }) as never)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      error: "审计服务暂不可用，本次变更未执行",
    })
    expect(isAdminAuditRequestId(response.headers.get("x-request-id"))).toBe(
      true
    )
    expect(setQuality).not.toHaveBeenCalled()
    expect(repo.proactiveReplies(1)[0]).toMatchObject({ id, quality: null })
    expect(repo.adminAudit.recent()).toEqual([])
  })
})
