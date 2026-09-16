import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAppContextMock,
  runCompactMock,
  runPromoteMock,
  promoteEntryMock,
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
    promoteEntryMock: vi.fn(),
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
  promoteEntry: promoteEntryMock,
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
import { embed as embedMock } from "@/lib/model/embed"

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
  promoteEntryMock.mockResolvedValue({
    ok: true,
    file: "retrieval/faq/api-errors.md",
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

  it("promote 走 promoteEntry(与定时升格同一路径)", async () => {
    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 7, action: "promote" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(200)
    expect(promoteEntryMock).toHaveBeenCalledWith({
      repo: expect.anything(),
      chunkId: 7,
      embed: expect.anything(),
    })
    // 手动路径没有 promoter 的 resolve() 包超时,必须自带包装:传进去的
    // 不能是裸 embed,否则挂死的本地 embedding 会把 HTTP 请求一直吊住。
    expect(promoteEntryMock.mock.calls[0][0].embed).not.toBe(embedMock)
    expect((await response.json()).data).toMatchObject({
      id: 7,
      status: "promoted",
      file: "retrieval/faq/api-errors.md",
      already: false,
    })
  })

  it("promoteEntry 失败 → 4xx 且不带文件", async () => {
    promoteEntryMock.mockResolvedValue({
      ok: false,
      reason: "单元超长(600 > 500)",
    })
    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 7, action: "promote" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("单元超长")
  })
})
