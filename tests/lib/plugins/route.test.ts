import { describe, it, expect, vi, beforeEach } from "vitest"

const listMock = vi.fn()
const installMock = vi.fn()
const addMarketplaceMock = vi.fn()
const reconfigureMock = vi.fn()

vi.mock("@/lib/plugins/manager", () => ({
  // 注:mockImplementation 必须用普通 function 而非箭头函数——route.ts 用 `new PluginManager(...)`
  // 构造实例,箭头函数没有 [[Construct]],`new` 会抛 "... is not a constructor"
  PluginManager: vi.fn().mockImplementation(function () {
    return {
      list: listMock,
      install: installMock,
      addMarketplace: addMarketplaceMock,
    }
  }),
}))
vi.mock("@/lib/runtime", () => ({
  getRuntime: () => ({ reconfigure: reconfigureMock }),
  defaultBuilders: async () => ({}),
}))
vi.mock("@/lib/db/shared", () => ({ sharedDb: () => ({}) }))
vi.mock("@/lib/db/repo", () => ({ Repo: vi.fn() }))
vi.mock("@/lib/config-store", () => ({
  getConfig: () => ({ claudeConfigDir: "/tmp/x", dbPath: ":memory:" }),
}))

import { GET, POST } from "@/app/api/plugins/route"

beforeEach(() => {
  listMock.mockReset()
  installMock.mockReset()
  addMarketplaceMock.mockReset()
  reconfigureMock.mockReset()
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
    expect(reconfigureMock).not.toHaveBeenCalled()
  })

  it("非法 body → 400", async () => {
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({ source: "x" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })
})
