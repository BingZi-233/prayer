import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAppContextMock,
  runCompactMock,
  runPromoteMock,
  applyPromoteMock,
  withKbMutationLockMock,
  reflectionEntriesMock,
  reflectionEntryDetailMock,
  setReflectionStatusMock,
  setCompactAtMock,
  setPromoteAtMock,
} = vi.hoisted(() => {
  const reflectionEntries = vi.fn(() => [])
  const repo = {
    reflectionEntries,
    reflectionEntryDetail: vi.fn(),
    setReflectionStatus: vi.fn(),
    setCompactAt: vi.fn(),
    setPromoteAt: vi.fn(),
  }
  return {
    getAppContextMock: vi.fn(() => ({
      cfg: {
        reflectCompactMinEntries: 3,
        reflectPromoteMinEntries: 1,
        reflectPromoteMaxPerRun: 5,
        reflectNotifyAdmin: false,
        adminSurface: null,
      },
      repo,
      configRepo: repo,
    })),
    runCompactMock: vi.fn(),
    runPromoteMock: vi.fn(),
    applyPromoteMock: vi.fn(),
    withKbMutationLockMock: vi.fn((fn: () => Promise<unknown>) => fn()),
    reflectionEntriesMock: reflectionEntries,
    reflectionEntryDetailMock: repo.reflectionEntryDetail,
    setReflectionStatusMock: repo.setReflectionStatus,
    setCompactAtMock: repo.setCompactAt,
    setPromoteAtMock: repo.setPromoteAt,
  }
})

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: getAppContextMock,
}))
vi.mock("@/lib/knowledge/reflection/compactor", () => ({
  runCompact: runCompactMock,
}))
vi.mock("@/lib/knowledge/reflection/promoter", () => ({
  runPromote: runPromoteMock,
}))
vi.mock("@/lib/knowledge/reflection/apply-promote", () => ({
  applyPromote: applyPromoteMock,
}))
vi.mock("@/lib/knowledge/mutation-lock", () => ({
  withKbMutationLock: withKbMutationLockMock,
}))
vi.mock("@/lib/model/embed", () => ({
  embed: vi.fn(),
}))

import { POST as compact } from "@/app/api/reflection/compact/route"
import { POST as promote } from "@/app/api/reflection/promote/route"
import { PATCH } from "@/app/api/reflection/route"

const emptyPost = () => new Request("http://x", { method: "POST" })

beforeEach(() => {
  vi.clearAllMocks()
  reflectionEntriesMock.mockReturnValue([])
  reflectionEntryDetailMock.mockReturnValue({
    id: 7,
    content: "FAQ",
    status: "approved",
  })
  setReflectionStatusMock.mockReturnValue(true)
  runCompactMock.mockResolvedValue(true)
  runPromoteMock.mockResolvedValue({ considered: 0, promoted: 0 })
  applyPromoteMock.mockResolvedValue({
    ok: true,
    file: "promoted/reflection-7.md",
    content: "FAQ",
  })
})

describe("manual reflection routes", () => {
  it("compact failure returns 503 and does not consume its cursor", async () => {
    runCompactMock.mockResolvedValue(false)

    const response = await compact(emptyPost())

    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain("反思整理失败")
    expect(setCompactAtMock).not.toHaveBeenCalled()
  })

  it("promote failure returns 503 and does not consume its cursor", async () => {
    runPromoteMock.mockResolvedValue({
      considered: 2,
      promoted: 0,
      failed: true,
    })

    const response = await promote(emptyPost())

    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain("反思升格失败")
    expect(setPromoteAtMock).not.toHaveBeenCalled()
  })

  it.each([
    ["approve", "approved"],
    ["reject", "rejected"],
  ] as const)(
    "%s status writes run under the KB mutation lock",
    async (action, status) => {
      const request = new Request("http://x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 7, action }),
      })

      const response = await PATCH(request as never)

      expect(response.status).toBe(200)
      expect(withKbMutationLockMock).toHaveBeenCalledOnce()
      expect(setReflectionStatusMock).toHaveBeenCalledWith(7, status)
    }
  )

  it("status writes reject missing entries instead of creating orphan metadata", async () => {
    reflectionEntryDetailMock.mockReturnValue(null)

    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 404, action: "approve" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(404)
    expect(setReflectionStatusMock).not.toHaveBeenCalled()
  })
})
