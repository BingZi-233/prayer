import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isAdminAuditRequestId } from "@/lib/core/admin-audit"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"

const {
  defaultBuilders,
  getAppContextMock,
  getStatus,
  reconfigure,
  runtimeFailureMessage,
  serializeRuntimeMutation,
} = vi.hoisted(() => ({
  defaultBuilders: vi.fn(async () => ({})),
  getAppContextMock: vi.fn(),
  getStatus: vi.fn(() => ({ state: "running" })),
  reconfigure: vi.fn(async () => undefined),
  runtimeFailureMessage: vi.fn(() => undefined),
  serializeRuntimeMutation: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: getAppContextMock,
}))
vi.mock("@/lib/runtime", () => ({
  defaultBuilders,
  getRuntime: () => ({ getStatus, reconfigure }),
  runtimeFailureMessage,
  serializeRuntimeMutation,
}))

import { POST } from "@/app/api/runtime/restart/route"

let db: ReturnType<typeof openDb>
let repo: Repo

describe("POST /api/runtime/restart audit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db = openDb(":memory:", 3)
    repo = new Repo(db)
    getAppContextMock.mockReturnValue({ cfg: {}, repo })
    getStatus.mockReturnValue({ state: "running" })
    runtimeFailureMessage.mockReturnValue(undefined)
    defaultBuilders.mockResolvedValue({})
    reconfigure.mockResolvedValue(undefined)
    serializeRuntimeMutation.mockImplementation((fn) => fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it("returns a server-generated correlation id and records a successful restart", async () => {
    const response = await POST(
      new Request("http://localhost/api/runtime/restart", { method: "POST" })
    )
    const requestId = response.headers.get("x-request-id")

    expect(response.status).toBe(200)
    expect(isAdminAuditRequestId(requestId)).toBe(true)
    expect(repo.adminAudit.getByRequestId(requestId!)).toMatchObject({
      action: "runtime.restart",
      result: "accepted",
      httpStatus: 200,
    })
    expect(reconfigure).toHaveBeenCalledOnce()
  })

  it("fails closed before runtime reconfiguration when audit start cannot persist", async () => {
    vi.spyOn(repo.adminAudit, "begin").mockImplementation(() => {
      throw new Error("audit unavailable")
    })

    const response = await POST(
      new Request("http://localhost/api/runtime/restart", { method: "POST" })
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      error: "审计服务暂不可用，本次变更未执行",
    })
    expect(isAdminAuditRequestId(response.headers.get("x-request-id"))).toBe(
      true
    )
    expect(reconfigure).not.toHaveBeenCalled()
  })
})
