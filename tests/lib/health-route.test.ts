import { beforeEach, describe, expect, it, vi } from "vitest"

const { getRuntimeMock } = vi.hoisted(() => ({
  getRuntimeMock: vi.fn(),
}))

vi.mock("@/lib/runtime", () => ({ getRuntime: getRuntimeMock }))

import { GET as live } from "@/app/health/live/route"
import { GET as ready } from "@/app/health/ready/route"

beforeEach(() => getRuntimeMock.mockReset())

describe("health routes", () => {
  it("liveness 不依赖 Runtime 且返回 200", async () => {
    getRuntimeMock.mockReturnValue(undefined)

    const response = live()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ ok: true, data: { live: true } })
    expect(getRuntimeMock).not.toHaveBeenCalled()
  })

  it("readiness 就绪时返回 200", async () => {
    const data = {
      ready: true,
      state: "running",
      requiredChannels: ["qq"],
      unavailableChannels: [],
      channels: [{ id: "qq", connected: true }],
    }
    getRuntimeMock.mockReturnValue({ getReadiness: () => data })

    const response = ready()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        ready: true,
        state: "running",
        requiredChannels: ["qq"],
        unavailableChannels: [],
        channels: [{ id: "qq", connected: true, hasError: false }],
        hasError: false,
      },
    })
  })

  it("readiness 未就绪时返回 503 并保留通道诊断", async () => {
    const data = {
      ready: false,
      state: "degraded",
      requiredChannels: ["qq", "tg"],
      unavailableChannels: [
        { id: "tg", connected: false, lastError: "401 Unauthorized" },
      ],
      channels: [
        { id: "qq", connected: true },
        { id: "tg", connected: false, lastError: "401 Unauthorized" },
      ],
      lastError: "tg: 401 Unauthorized",
    }
    getRuntimeMock.mockReturnValue({ getReadiness: () => data })

    const response = ready()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      error: "runtime not ready",
      data: {
        ready: false,
        state: "degraded",
        requiredChannels: ["qq", "tg"],
        unavailableChannels: [{ id: "tg", connected: false, hasError: true }],
        channels: [
          { id: "qq", connected: true, hasError: false },
          { id: "tg", connected: false, hasError: true },
        ],
        hasError: true,
      },
    })
  })

  it("Runtime 诊断抛错时仍返回 503", async () => {
    getRuntimeMock.mockReturnValue({
      getReadiness: () => {
        throw new Error("secret provider response")
      },
    })
    const response = ready()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: false,
      error: "runtime unavailable",
      data: { ready: false, state: "error", hasError: true },
    })
    expect(JSON.stringify(body)).not.toContain("secret provider")
  })
})
