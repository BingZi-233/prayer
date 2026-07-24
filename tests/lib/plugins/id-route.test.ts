import { describe, it, expect, vi, beforeEach } from "vitest"

const enableMock = vi.fn()
const disableMock = vi.fn()
const updateMock = vi.fn()
const uninstallMock = vi.fn()
const reconfigureMock = vi.fn()

vi.mock("@/lib/plugins/manager", () => ({
  PluginManager: vi.fn().mockImplementation(function () {
    return {
      enable: enableMock,
      disable: disableMock,
      update: updateMock,
      uninstall: uninstallMock,
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

import { PATCH, DELETE } from "@/app/api/plugins/[id]/route"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  ;[
    enableMock,
    disableMock,
    updateMock,
    uninstallMock,
    reconfigureMock,
  ].forEach((m) => m.mockReset())
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
  })

  it("CLI 失败 → 500,不 reconfigure", async () => {
    updateMock.mockResolvedValue({ ok: false, error: "x" })
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "update" }),
    })
    const res = await PATCH(req as never, ctx("pkg@mkt") as never)
    expect(res.status).toBe(500)
    expect(reconfigureMock).not.toHaveBeenCalled()
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
    expect(uninstallMock).toHaveBeenCalledWith("pkg@mkt")
    expect(reconfigureMock).toHaveBeenCalled()
  })
})
