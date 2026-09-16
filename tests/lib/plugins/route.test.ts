import { describe, it, expect, vi, beforeEach } from "vitest"
import { isAdminAuditRequestId } from "@/lib/core/admin-audit"

const listMock = vi.fn()
const findMock = vi.fn()
const installMock = vi.fn()
const uninstallMock = vi.fn()
const addMarketplaceMock = vi.fn()
const listMarketplacesMock = vi.fn()
const removeMarketplaceMock = vi.fn()
const reconfigureMock = vi.fn()
const {
  beginMock,
  finishMock,
  getAppContextMock,
  runtimeFailureMessageMock,
  serializeRuntimeMutationMock,
} = vi.hoisted(() => ({
  beginMock: vi.fn(),
  finishMock: vi.fn(),
  getAppContextMock: vi.fn(),
  runtimeFailureMessageMock: vi.fn(() => undefined as string | undefined),
  serializeRuntimeMutationMock: vi.fn((fn: () => Promise<unknown>) => fn()),
}))
/* keep route mocks hoisted; the real helper is exercised in manager tests */
const routeRollback = vi.hoisted(() => ({
  bestEffortPluginRollback: async (
    rollback?: () => Promise<{ ok: boolean; error?: string }>
  ) => (rollback ? rollback() : undefined),
}))

vi.mock("@/lib/model/plugins/manager", () => ({
  isValidPluginRef: (ref: string) => /^[A-Za-z0-9._@/-]+$/.test(ref),
  // 注:mockImplementation 必须用普通 function 而非箭头函数——route.ts 用 `new PluginManager(...)`
  // 构造实例,箭头函数没有 [[Construct]],`new` 会抛 "... is not a constructor"
  PluginManager: vi.fn().mockImplementation(function () {
    return {
      list: listMock,
      find: findMock,
      install: installMock,
      uninstall: uninstallMock,
      addMarketplace: addMarketplaceMock,
      listMarketplaces: listMarketplacesMock,
      removeMarketplace: removeMarketplaceMock,
    }
  }),
  ...routeRollback,
}))
vi.mock("@/lib/runtime", () => ({
  getRuntime: () => ({
    reconfigure: reconfigureMock,
    getStatus: () => ({ state: "running" }),
  }),
  defaultBuilders: async () => ({}),
  runtimeFailureMessage: runtimeFailureMessageMock,
  serializeRuntimeMutation: serializeRuntimeMutationMock,
}))
vi.mock("@/lib/core/db/shared", () => ({ sharedDb: () => ({}) }))
vi.mock("@/lib/core/db/repo", () => ({ Repo: vi.fn() }))
vi.mock("@/lib/core/app-context", () => ({ getAppContext: getAppContextMock }))
vi.mock("@/lib/core/config-store", () => ({
  getConfig: () => ({ claudeConfigDir: "/tmp/x", dbPath: ":memory:" }),
}))

import { GET, POST } from "@/app/api/plugins/route"

beforeEach(() => {
  listMock.mockReset()
  findMock.mockReset()
  installMock.mockReset()
  uninstallMock.mockReset()
  addMarketplaceMock.mockReset()
  listMarketplacesMock.mockReset()
  removeMarketplaceMock.mockReset()
  reconfigureMock.mockReset()
  beginMock.mockReset()
  finishMock.mockReset()
  getAppContextMock.mockReset()
  runtimeFailureMessageMock.mockReset()
  serializeRuntimeMutationMock.mockClear()
  beginMock.mockReturnValue(1)
  finishMock.mockReturnValue(true)
  getAppContextMock.mockReturnValue({
    cfg: { claudeConfigDir: "/tmp/x", dbPath: ":memory:" },
    configRepo: {},
    repo: { adminAudit: { begin: beginMock, finish: finishMock } },
  })
  findMock.mockResolvedValue(undefined)
  listMarketplacesMock.mockResolvedValue([])
  removeMarketplaceMock.mockResolvedValue({ ok: true })
})

describe("GET /api/plugins", () => {
  it("返回 list", async () => {
    listMock.mockResolvedValue([
      {
        id: "a@b",
        version: "1",
        scope: "user",
        enabled: true,
        installPath: "x",
      },
    ])
    const res = await GET()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(1)
  })
})

describe("POST /api/plugins", () => {
  it("github:先 addMarketplace 再 install,成功后 reconfigure", async () => {
    addMarketplaceMock.mockResolvedValue({ ok: true })
    installMock.mockResolvedValue({ ok: true })
    listMock.mockResolvedValue([])
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({
        source: "github",
        repoOrPath: "owner/repo",
        marketplaceName: "repo",
        pluginName: "pkg",
      }),
    })
    const res = await POST(req as never)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const requestId = res.headers.get("x-request-id")
    expect(isAdminAuditRequestId(requestId)).toBe(true)
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "plugins.install",
        route: "/api/plugins",
        method: "POST",
        requestId,
      })
    )
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "accepted", httpStatus: 200 })
    )
    expect(addMarketplaceMock).toHaveBeenCalledWith("owner/repo")
    expect(installMock).toHaveBeenCalledWith("pkg", "repo")
    expect(reconfigureMock).toHaveBeenCalled()
  })

  it("install 失败 → 500,不 reconfigure", async () => {
    addMarketplaceMock.mockResolvedValue({ ok: true })
    installMock.mockResolvedValue({ ok: false, error: "boom" })
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({
        source: "directory",
        repoOrPath: "/abs/p",
        marketplaceName: "mkt",
        pluginName: "pkg",
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(500)
    expect(isAdminAuditRequestId(res.headers.get("x-request-id"))).toBe(true)
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "failed", httpStatus: 500 })
    )
    expect(reconfigureMock).not.toHaveBeenCalled()
    expect(removeMarketplaceMock).toHaveBeenCalledWith("mkt")
  })

  it("install 后运行时失败 → 卸载新插件并清理本次新增 marketplace", async () => {
    addMarketplaceMock.mockResolvedValue({ ok: true })
    installMock.mockResolvedValue({ ok: true })
    uninstallMock.mockResolvedValue({ ok: true })
    runtimeFailureMessageMock.mockReturnValue("runtime failed")
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({
        source: "github",
        repoOrPath: "owner/repo",
        marketplaceName: "repo",
        pluginName: "pkg",
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(503)
    expect(uninstallMock).toHaveBeenCalledWith("pkg@repo")
    expect(removeMarketplaceMock).toHaveBeenCalledWith("repo")
    expect((await res.json()).error).toContain("已回滚")
  })

  it("同 ref 已安装 → 409 且不覆盖插件或 marketplace", async () => {
    findMock.mockResolvedValue({ id: "pkg@repo" })
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({
        source: "github",
        repoOrPath: "owner/repo",
        marketplaceName: "repo",
        pluginName: "pkg",
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(409)
    expect(finishMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "rejected", httpStatus: 409 })
    )
    expect(addMarketplaceMock).not.toHaveBeenCalled()
    expect(installMock).not.toHaveBeenCalled()
  })

  it("同名同源 marketplace → 复用且不重新 add", async () => {
    listMarketplacesMock.mockResolvedValue([
      { name: "repo", source: "github", repo: "owner/repo" },
    ])
    installMock.mockResolvedValue({ ok: true })
    listMock.mockResolvedValue([])
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({
        source: "github",
        repoOrPath: "owner/repo",
        marketplaceName: "repo",
        pluginName: "pkg",
      }),
    })
    const res = await POST(req as never)
    expect((await res.json()).ok).toBe(true)
    expect(addMarketplaceMock).not.toHaveBeenCalled()
    expect(removeMarketplaceMock).not.toHaveBeenCalled()
  })

  it("同名不同源 marketplace → 409 且保持原来源", async () => {
    listMarketplacesMock.mockResolvedValue([
      { name: "repo", source: "github", repo: "other/repo" },
    ])
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({
        source: "github",
        repoOrPath: "owner/repo",
        marketplaceName: "repo",
        pluginName: "pkg",
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(409)
    expect(addMarketplaceMock).not.toHaveBeenCalled()
  })

  it("非法 body → 400", async () => {
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({ source: "x" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    expect(beginMock).not.toHaveBeenCalled()
  })

  it("审计起始失败时不触达 CLI、运行时或序列化回调", async () => {
    beginMock.mockImplementation(() => {
      throw new Error("audit unavailable")
    })
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({
        source: "github",
        repoOrPath: "owner/repo",
        marketplaceName: "repo",
        pluginName: "pkg",
      }),
    })

    const res = await POST(req as never)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      error: "审计服务暂不可用，本次变更未执行",
    })
    expect(isAdminAuditRequestId(res.headers.get("x-request-id"))).toBe(true)
    expect(serializeRuntimeMutationMock).not.toHaveBeenCalled()
    expect(findMock).not.toHaveBeenCalled()
    expect(addMarketplaceMock).not.toHaveBeenCalled()
    expect(installMock).not.toHaveBeenCalled()
    expect(reconfigureMock).not.toHaveBeenCalled()
    expect(finishMock).not.toHaveBeenCalled()
  })
})
