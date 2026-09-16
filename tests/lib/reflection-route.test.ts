import { beforeEach, describe, expect, it, vi } from "vitest"
import { isAdminAuditRequestId } from "@/lib/core/admin-audit"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"

const {
  getAppContextMock,
  runCompactMock,
  runPromoteMock,
  promoteEntryMock,
  withKbMutationLockMock,
  withTimeoutFnMock,
  emitErrorSafelyMock,
  reflectionEntriesMock,
  reflectionEntryDetailMock,
  setReflectionStatusMock,
  setCompactAtMock,
  setPromoteAtMock,
  beginMock,
  finishMock,
} = vi.hoisted(() => {
  const reflectionEntries = vi.fn(() => [])
  const begin = vi.fn(() => 1)
  const finish = vi.fn(() => true)
  const repo = {
    adminAudit: { begin, finish },
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
    // 透传包装:这里测的是「路由有没有套超时、套的是哪个常量」,不是超时本身
    // (withTimeout 自己的行为另有测试)。返回原函数即可,断言靠调用参数。
    withTimeoutFnMock: vi.fn(
      (_ms: number, fn: (text: string) => unknown) => fn
    ),
    emitErrorSafelyMock: vi.fn(),
    reflectionEntriesMock: reflectionEntries,
    reflectionEntryDetailMock: repo.reflectionEntryDetail,
    setReflectionStatusMock: repo.setReflectionStatus,
    setCompactAtMock: repo.setCompactAt,
    setPromoteAtMock: repo.setPromoteAt,
    beginMock: begin,
    finishMock: finish,
  }
})

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: getAppContextMock,
}))
vi.mock("@/lib/knowledge/reflection/compactor", () => ({
  runCompactWithOutcome: runCompactMock,
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
// 只换掉 withTimeoutFn,常量仍取真实值:这样「路由硬编码了别的超时值」也会红。
vi.mock("@/lib/model/timeout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/model/timeout")>()),
  withTimeoutFn: withTimeoutFnMock,
}))
vi.mock("@/lib/core/bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/bus")>()),
  emitErrorSafely: emitErrorSafelyMock,
}))

import { POST as compact } from "@/app/api/reflection/compact/route"
import { POST as promote } from "@/app/api/reflection/promote/route"
import { PATCH } from "@/app/api/reflection/route"
import { embed as embedMock } from "@/lib/model/embed"
import { DEFAULT_EMBED_TIMEOUT_MS } from "@/lib/model/timeout"

const emptyPost = () => new Request("http://x", { method: "POST" })

function expectRequestId(response: Response): string {
  const requestId = response.headers.get("x-request-id")
  expect(isAdminAuditRequestId(requestId)).toBe(true)
  return requestId!
}

beforeEach(() => {
  vi.clearAllMocks()
  reflectionEntriesMock.mockReturnValue([])
  reflectionEntryDetailMock.mockReturnValue({
    id: 7,
    content: "FAQ",
    status: "approved",
  })
  setReflectionStatusMock.mockReturnValue(true)
  runCompactMock.mockResolvedValue("completed")
  runPromoteMock.mockResolvedValue({ considered: 0, promoted: 0 })
  promoteEntryMock.mockResolvedValue({
    ok: true,
    file: "retrieval/faq/api-errors.md",
    content: "FAQ",
  })
})

describe("manual reflection routes", () => {
  it("compact failure returns 503 and does not consume its cursor", async () => {
    runCompactMock.mockResolvedValue("failed")

    const response = await compact(emptyPost())

    expect(response.status).toBe(503)
    expectRequestId(response)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reflection.compact" })
    )
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "failed", httpStatus: 503 })
    )
    expect((await response.json()).error).toContain("反思整理失败")
    expect(setCompactAtMock).not.toHaveBeenCalled()
  })

  it("compact success records an accepted audit result", async () => {
    const response = await compact(emptyPost())

    expect(response.status).toBe(200)
    expectRequestId(response)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reflection.compact" })
    )
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "accepted", httpStatus: 200 })
    )
    expect(setCompactAtMock).toHaveBeenCalledOnce()
  })

  it("compact partial outcome persists partial without consuming its cursor", async () => {
    const db = openDb(":memory:", 3)
    const auditRepo = new Repo(db)
    const setCompactAt = vi.spyOn(auditRepo, "setCompactAt")
    try {
      getAppContextMock.mockReturnValueOnce({
        cfg: {
          reflectCompactMinEntries: 3,
          reflectPromoteMinEntries: 1,
          reflectPromoteMaxPerRun: 5,
          reflectNotifyAdmin: false,
          adminSurface: null,
        },
        repo: auditRepo,
        configRepo: auditRepo,
      } as never)
      runCompactMock.mockResolvedValue("partial")

      const response = await compact(emptyPost())
      const requestId = expectRequestId(response)

      expect(response.status).toBe(503)
      expect(auditRepo.adminAudit.getByRequestId(requestId)).toMatchObject({
        action: "reflection.compact",
        route: "/api/reflection/compact",
        method: "POST",
        result: "partial",
        httpStatus: 503,
        detail: {},
      })
      expect(setCompactAt).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it("promote failure returns 503 and does not consume its cursor", async () => {
    runPromoteMock.mockResolvedValue({
      considered: 2,
      promoted: 0,
      failed: true,
    })

    const response = await promote(emptyPost())

    expect(response.status).toBe(503)
    expectRequestId(response)
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "failed", httpStatus: 503 })
    )
    expect((await response.json()).error).toContain("反思升格失败")
    expect(setPromoteAtMock).not.toHaveBeenCalled()
  })

  it("promote success records an accepted audit result", async () => {
    const response = await promote(emptyPost())

    expect(response.status).toBe(200)
    expectRequestId(response)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reflection.promote" })
    )
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "accepted", httpStatus: 200 })
    )
    expect(setPromoteAtMock).toHaveBeenCalledOnce()
  })

  it("promote 部分失败时如实上报已升格条数", async () => {
    runPromoteMock.mockResolvedValue({
      considered: 3,
      promoted: 2,
      failed: true,
    })

    const response = await promote(emptyPost())

    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain("已升格 2 条")
    expect(setPromoteAtMock).not.toHaveBeenCalled()
  })

  it("promote 部分失败时将 503 如实持久化为 partial", async () => {
    const db = openDb(":memory:", 3)
    const auditRepo = new Repo(db)
    try {
      getAppContextMock.mockReturnValueOnce({
        cfg: {
          reflectCompactMinEntries: 3,
          reflectPromoteMinEntries: 1,
          reflectPromoteMaxPerRun: 5,
          reflectNotifyAdmin: false,
          adminSurface: null,
        },
        repo: auditRepo,
        configRepo: auditRepo,
      } as never)
      runPromoteMock.mockResolvedValue({
        considered: 3,
        promoted: 2,
        failed: true,
      })

      const response = await promote(emptyPost())
      const requestId = expectRequestId(response)

      expect(response.status).toBe(503)
      expect(auditRepo.adminAudit.getByRequestId(requestId)).toMatchObject({
        action: "reflection.promote",
        route: "/api/reflection/promote",
        method: "POST",
        result: "partial",
        httpStatus: 503,
        detail: {},
      })
    } finally {
      db.close()
    }
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
      expectRequestId(response)
      expect(beginMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: `reflection.${action}` })
      )
      expect(finishMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ result: "accepted", httpStatus: 200 })
      )
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
    expectRequestId(response)
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "rejected", httpStatus: 404 })
    )
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
    expectRequestId(response)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reflection.entry_promote" })
    )
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "accepted", httpStatus: 200 })
    )
    expect(promoteEntryMock).toHaveBeenCalledWith({
      repo: expect.anything(),
      chunkId: 7,
      embed: expect.anything(),
    })
    // 手动路径没有 promoter 的 resolve() 包超时,必须自带包装:裸 embed 会让
    // HTTP 请求一直等一个挂死的本地 embedding。断言的是「用默认 embed 超时常量
    // 包了裸 embed」,撤掉包装或改错常量都会红。
    expect(withTimeoutFnMock).toHaveBeenCalledWith(
      DEFAULT_EMBED_TIMEOUT_MS,
      embedMock
    )
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
    expectRequestId(response)
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "rejected", httpStatus: 400 })
    )
    expect((await response.json()).error).toContain("单元超长")
  })

  it("promoteEntry 报 already → 200 且 already 为真", async () => {
    promoteEntryMock.mockResolvedValue({
      ok: true,
      file: "",
      content: "FAQ",
      already: true,
    })
    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 7, action: "promote" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      id: 7,
      status: "promoted",
      already: true,
    })
  })

  it("promoteEntry 报条目不存在 → 404", async () => {
    promoteEntryMock.mockResolvedValue({ ok: false, reason: "条目不存在" })
    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 7, action: "promote" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(404)
  })

  it("promoteEntry 报内部一致性故障 → 409 而非 404/400", async () => {
    // 「目标文档不存在」含「不存在」三个字,但它指索引里有该 doc、磁盘上文件
    // 却丢了——是系统内部故障,不是条目 id 不存在。用子串判断会误报成 404,
    // 让操作员以为该条目不存在(本特性最不该撒的谎)。
    promoteEntryMock.mockResolvedValue({
      ok: false,
      reason: "目标文档不存在",
    })
    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 7, action: "promote" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain("目标文档不存在")
  })

  it("promoteEntry 抛异常 → 500 且进错误总线", async () => {
    promoteEntryMock.mockRejectedValue(new Error("成文超时"))
    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 7, action: "promote" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(500)
    expectRequestId(response)
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "failed", httpStatus: 500 })
    )
    // 定时路径超时会 emitErrorSafely,手动路径不能只在响应里说一声就完事。
    expect(emitErrorSafelyMock).toHaveBeenCalledOnce()
    expect(emitErrorSafelyMock.mock.calls[0][0]).toMatchObject({
      scope: "reflection-promote",
      userVisible: false,
    })
  })

  it("entry promote audit start failure prevents embedding and promotion", async () => {
    beginMock.mockImplementationOnce(() => {
      throw new Error("audit unavailable")
    })
    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 7, action: "promote" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(503)
    expectRequestId(response)
    expect(promoteEntryMock).not.toHaveBeenCalled()
    expect(withTimeoutFnMock).not.toHaveBeenCalled()
    expect(finishMock).not.toHaveBeenCalled()
  })

  it("status audit start failure prevents reflection reads and writes", async () => {
    beginMock.mockImplementationOnce(() => {
      throw new Error("audit unavailable")
    })
    const request = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 7, action: "approve" }),
    })

    const response = await PATCH(request as never)

    expect(response.status).toBe(503)
    expectRequestId(response)
    expect(reflectionEntryDetailMock).not.toHaveBeenCalled()
    expect(setReflectionStatusMock).not.toHaveBeenCalled()
    expect(finishMock).not.toHaveBeenCalled()
  })

  it("compact audit start failure prevents reflection reads and compaction", async () => {
    beginMock.mockImplementationOnce(() => {
      throw new Error("audit unavailable")
    })

    const response = await compact(emptyPost())

    expect(response.status).toBe(503)
    expectRequestId(response)
    expect(reflectionEntriesMock).not.toHaveBeenCalled()
    expect(runCompactMock).not.toHaveBeenCalled()
    expect(setCompactAtMock).not.toHaveBeenCalled()
    expect(finishMock).not.toHaveBeenCalled()
  })

  it("promote audit start failure prevents reflection reads and promotion", async () => {
    beginMock.mockImplementationOnce(() => {
      throw new Error("audit unavailable")
    })

    const response = await promote(emptyPost())

    expect(response.status).toBe(503)
    expectRequestId(response)
    expect(reflectionEntriesMock).not.toHaveBeenCalled()
    expect(runPromoteMock).not.toHaveBeenCalled()
    expect(setPromoteAtMock).not.toHaveBeenCalled()
    expect(finishMock).not.toHaveBeenCalled()
  })
})
