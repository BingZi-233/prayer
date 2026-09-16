import { beforeEach, describe, expect, it, vi } from "vitest"

const { emitMock, getAppContextMock, isHumanModeMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  getAppContextMock: vi.fn(),
  isHumanModeMock: vi.fn(),
}))

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: getAppContextMock,
}))
vi.mock("@/lib/core/bus", () => ({
  bus: { emit: emitMock },
}))

import { POST } from "@/app/api/sessions/route"

function resumeRequest(key = "qq:group:user") {
  return new Request("http://x/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "resume_handoff", key }),
  })
}

beforeEach(() => {
  emitMock.mockReset()
  getAppContextMock.mockReset()
  isHumanModeMock.mockReset()
  getAppContextMock.mockReturnValue({
    repo: { isHumanMode: isHumanModeMock },
    cfg: { resumeTtlMs: 0 },
  })
})

describe("POST /api/sessions resume_handoff", () => {
  it("以后台 UI 来源恢复正在人工接待的会话", async () => {
    isHumanModeMock.mockReturnValueOnce(true).mockReturnValue(false)
    emitMock.mockReturnValue(true)

    const res = await POST(resumeRequest() as never)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { resumed: 1 } })
    expect(emitMock).toHaveBeenCalledWith("handoff.resumed", {
      sessionKey: "qq:group:user",
      by: "ui",
    })
  })

  it("会话不在人工接待中时不伪报恢复成功", async () => {
    isHumanModeMock.mockReturnValue(false)

    const res = await POST(resumeRequest() as never)

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      ok: false,
      error: "会话未处于人工接待中",
    })
    expect(emitMock).not.toHaveBeenCalled()
  })

  it("处理器未就绪时不伪报恢复成功", async () => {
    isHumanModeMock.mockReturnValue(true)
    emitMock.mockReturnValue(false)

    const res = await POST(resumeRequest() as never)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      error: "人工接待处理器未就绪",
    })
  })

  it("处理器未结束人工接待时不伪报恢复成功", async () => {
    isHumanModeMock.mockReturnValue(true)
    emitMock.mockReturnValue(true)

    const res = await POST(resumeRequest() as never)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      error: "恢复自动答未完成",
    })
  })
})
