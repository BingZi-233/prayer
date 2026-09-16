import { describe, it, expect, vi, beforeEach } from "vitest"
import { isAdminAuditRequestId } from "@/lib/core/admin-audit"

const enableMock = vi.fn()
const disableMock = vi.fn()
const updateMock = vi.fn()
const uninstallMock = vi.fn()
const findMock = vi.fn()
const restoreEnabledMock = vi.fn()
const reconfigureMock = vi.fn()
const getStatusMock = vi.fn(() => ({ state: "running" as const }))
const {
  beginMock,
  finishMock,
  getAppContextMock,
  runtimeFailureMessageMock,
  serializeRuntimeMutationMock,
  bestEffortPluginRollback,
} = vi.hoisted(() => ({
  beginMock: vi.fn(),
  finishMock: vi.fn(),
  getAppContextMock: vi.fn(),
  runtimeFailureMessageMock: vi.fn(() => undefined as string | undefined),
  serializeRuntimeMutationMock: vi.fn((fn: () => Promise<unknown>) => fn()),
  bestEffortPluginRollback: async (
    rollback?: () => Promise<{ ok: boolean; error?: string }>
  ) => (rollback ? rollback() : undefined),
}))

vi.mock("@/lib/model/plugins/manager", () => ({
  isValidPluginRef: (ref: string) => /^[A-Za-z0-9._@/-]+$/.test(ref),
  PluginManager: vi.fn().mockImplementation(function () {
    return {
      enable: enableMock,
      disable: disableMock,
      update: updateMock,
      uninstall: uninstallMock,
      find: findMock,
      restoreEnabled: restoreEnabledMock,
    }
  }),
  bestEffortPluginRollback,
}))
vi.mock("@/lib/runtime", () => ({
  getRuntime: () => ({
    reconfigure: reconfigureMock,
    getStatus: getStatusMock,
  }),
  defaultBuilders: async () => ({}),
  runtimeFailureMessage: runtimeFailureMessageMock,
  serializeRuntimeMutation: serializeRuntimeMutationMock,
}))
vi.mock("@/lib/core/db/shared", () => ({ sharedDb: () => ({}) }))
vi.mock("@/lib/core/db/repo", () => ({ Repo: vi.fn() }))
vi.mock("@/lib/core/config-store", () => ({
  getConfig: () => ({ claudeConfigDir: "/tmp/x", dbPath: ":memory:" }),
}))
vi.mock("@/lib/core/app-context", () => ({ getAppContext: getAppContextMock }))

import { PATCH, DELETE } from "@/app/api/plugins/[id]/route"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  ;[
    enableMock,
    disableMock,
    updateMock,
    uninstallMock,
    findMock,
    restoreEnabledMock,
    reconfigureMock,
    getStatusMock,
    runtimeFailureMessageMock,
  ].forEach((m) => m.mockReset())
  beginMock.mockReset()
  finishMock.mockReset()
  getAppContextMock.mockReset()
  serializeRuntimeMutationMock.mockClear()
  beginMock.mockReturnValue(1)
  finishMock.mockReturnValue(true)
  getAppContextMock.mockReturnValue({
    cfg: { claudeConfigDir: "/tmp/x", dbPath: ":memory:" },
    configRepo: {},
    repo: { adminAudit: { begin: beginMock, finish: finishMock } },
  })
  findMock.mockResolvedValue({
    id: "pkg@mkt",
    version: "1.0.0",
    scope: "user",
    enabled: false,
    installPath: "/tmp/pkg",
  })
  restoreEnabledMock.mockResolvedValue({ ok: true })
})

describe("PATCH /api/plugins/[id]", () => {
  it("action=enable 调 enable(id) + reconfigure", async () => {
    enableMock.mockResolvedValue({ ok: true })
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "enable" }),
    })
    const res = await PATCH(req as never, ctx("pkg@mkt") as never)
    expect((await res.json()).ok).toBe(true)
    const requestId = res.headers.get("x-request-id")
    expect(isAdminAuditRequestId(requestId)).toBe(true)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "plugins.enable",
        route: "/api/plugins/[id]",
        method: "PATCH",
        requestId,
      })
    )
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "accepted", httpStatus: 200 })
    )
    expect(enableMock).toHaveBeenCalledWith("pkg@mkt")
    expect(reconfigureMock).toHaveBeenCalled()
  })

  it("非法 action → 400", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "boom" }),
    })
    const res = await PATCH(req as never, ctx("pkg@mkt") as never)
    expect(res.status).toBe(400)
    expect(beginMock).not.toHaveBeenCalled()
  })

  it("CLI 失败 → 500,不 reconfigure", async () => {
    updateMock.mockResolvedValue({ ok: false, error: "x" })
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "update" }),
    })
    const res = await PATCH(req as never, ctx("pkg@mkt") as never)
    expect(res.status).toBe(500)
    expect(isAdminAuditRequestId(res.headers.get("x-request-id"))).toBe(true)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plugins.update" })
    )
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "failed", httpStatus: 500 })
    )
    expect(reconfigureMock).not.toHaveBeenCalled()
  })

  it("enable 后运行时失败 → 反向 disable 并返回已回滚", async () => {
    enableMock.mockResolvedValue({ ok: true })
    restoreEnabledMock.mockResolvedValue({ ok: true })
    runtimeFailureMessageMock.mockReturnValue("runtime failed")
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "enable" }),
    })
    const res = await PATCH(req as never, ctx("pkg@mkt") as never)
    expect(res.status).toBe(503)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plugins.enable" })
    )
    expect(restoreEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pkg@mkt", enabled: false })
    )
    expect((await res.json()).error).toContain("已回滚")
  })

  it("disable 后运行时失败 → 反向 enable", async () => {
    disableMock.mockResolvedValue({ ok: true })
    findMock.mockResolvedValue({
      id: "pkg@mkt",
      version: "1.0.0",
      scope: "user",
      enabled: true,
      installPath: "/tmp/pkg",
    })
    restoreEnabledMock.mockResolvedValue({ ok: true })
    runtimeFailureMessageMock.mockReturnValue("runtime failed")
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "disable" }),
    })
    const res = await PATCH(req as never, ctx("pkg@mkt") as never)
    expect(res.status).toBe(503)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plugins.disable" })
    )
    expect(restoreEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pkg@mkt", enabled: true })
    )
  })

  it("update 后运行时失败 → 明确说明无法自动回滚", async () => {
    updateMock.mockResolvedValue({ ok: true })
    runtimeFailureMessageMock.mockReturnValue("runtime failed")
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "update" }),
    })
    const res = await PATCH(req as never, ctx("pkg@mkt") as never)
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain("update 无法自动回滚")
    expect(enableMock).not.toHaveBeenCalled()
    expect(disableMock).not.toHaveBeenCalled()
  })

  it("已经是目标状态 → 幂等成功且不触发 CLI 或重载", async () => {
    findMock.mockResolvedValue({
      id: "pkg@mkt",
      version: "1.0.0",
      scope: "user",
      enabled: true,
      installPath: "/tmp/pkg",
    })
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "enable" }),
    })
    const res = await PATCH(req as never, ctx("pkg@mkt") as never)
    expect((await res.json()).ok).toBe(true)
    expect(enableMock).not.toHaveBeenCalled()
    expect(reconfigureMock).not.toHaveBeenCalled()
  })

  it("审计起始失败时不读取插件、不触发 CLI 或运行时", async () => {
    beginMock.mockImplementation(() => {
      throw new Error("audit unavailable")
    })
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "enable" }),
    })

    const res = await PATCH(req as never, ctx("pkg@mkt") as never)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      error: "审计服务暂不可用，本次变更未执行",
    })
    expect(isAdminAuditRequestId(res.headers.get("x-request-id"))).toBe(true)
    expect(serializeRuntimeMutationMock).not.toHaveBeenCalled()
    expect(findMock).not.toHaveBeenCalled()
    expect(enableMock).not.toHaveBeenCalled()
    expect(reconfigureMock).not.toHaveBeenCalled()
    expect(finishMock).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/plugins/[id]", () => {
  it("uninstall + reconfigure", async () => {
    uninstallMock.mockResolvedValue({ ok: true })
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }) as never,
      ctx("pkg@mkt") as never
    )
    expect((await res.json()).ok).toBe(true)
    const requestId = res.headers.get("x-request-id")
    expect(isAdminAuditRequestId(requestId)).toBe(true)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "plugins.uninstall",
        route: "/api/plugins/[id]",
        method: "DELETE",
        requestId,
      })
    )
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "accepted", httpStatus: 200 })
    )
    expect(uninstallMock).toHaveBeenCalledWith("pkg@mkt")
    expect(reconfigureMock).toHaveBeenCalled()
  })

  it("uninstall 后运行时失败 → 不按 id 重装未知版本", async () => {
    uninstallMock.mockResolvedValue({ ok: true })
    runtimeFailureMessageMock.mockReturnValue("runtime failed")
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }) as never,
      ctx("pkg@mkt") as never
    )
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain("无法精确自动回滚")
  })

  it("插件不存在 → 404 且不触达 CLI", async () => {
    findMock.mockResolvedValue(undefined)
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }) as never,
      ctx("pkg@mkt") as never
    )
    expect(res.status).toBe(404)
    expect(uninstallMock).not.toHaveBeenCalled()
  })

  it("非法插件引用在审计和 CLI 前被拒绝", async () => {
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }) as never,
      ctx("bad ref") as never
    )

    expect(res.status).toBe(400)
    expect(beginMock).not.toHaveBeenCalled()
    expect(findMock).not.toHaveBeenCalled()
    expect(uninstallMock).not.toHaveBeenCalled()
  })

  it("审计起始失败时不读取插件、不卸载或重载", async () => {
    beginMock.mockImplementation(() => {
      throw new Error("audit unavailable")
    })

    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }) as never,
      ctx("pkg@mkt") as never
    )

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      error: "审计服务暂不可用，本次变更未执行",
    })
    expect(isAdminAuditRequestId(res.headers.get("x-request-id"))).toBe(true)
    expect(serializeRuntimeMutationMock).not.toHaveBeenCalled()
    expect(findMock).not.toHaveBeenCalled()
    expect(uninstallMock).not.toHaveBeenCalled()
    expect(reconfigureMock).not.toHaveBeenCalled()
    expect(finishMock).not.toHaveBeenCalled()
  })
})
