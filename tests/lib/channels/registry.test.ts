import { describe, it, expect } from "vitest"
import { ChannelRegistry } from "@/lib/channels/registry"
import type { Channel, ChannelCapabilities, ChannelId } from "@/lib/channels/types"

const caps: ChannelCapabilities = {
  canNotifyOwnAdminSurface: false,
  supportsAdminCommands: false,
  supportsMemberList: false,
  supportsGroupList: false,
  supportsMediaDownload: false,
  supportsBypassPipeline: false,
}

function makeChannel(
  id: ChannelId,
  opts: {
    failStart?: boolean
    onStart?: () => void
    onStop?: () => void
  } = {}
): Channel & { lastError?: string; setLastError: (e: string) => void } {
  let connected = false
  let lastError: string | undefined
  return {
    id,
    capabilities: caps,
    get lastError() {
      return lastError
    },
    setLastError(e: string) {
      lastError = e
    },
    async start() {
      opts.onStart?.()
      if (opts.failStart) throw new Error(`${id}-boom`)
      connected = true
    },
    async stop() {
      opts.onStop?.()
      connected = false
    },
    isConnected() {
      return connected
    },
    status() {
      return { id, connected, lastError }
    },
  }
}

describe("ChannelRegistry", () => {
  it("register + get", () => {
    const reg = new ChannelRegistry()
    const qq = makeChannel("qq")
    reg.register(qq)
    expect(reg.get("qq")).toBe(qq)
    expect(reg.get("tg")).toBeUndefined()
  })

  it("startAll 并行启动所有通道", async () => {
    const reg = new ChannelRegistry()
    const order: string[] = []
    reg.register(
      makeChannel("qq", { onStart: () => order.push("qq") })
    )
    reg.register(
      makeChannel("tg", { onStart: () => order.push("tg") })
    )
    const results = await reg.startAll()
    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    expect(order.sort()).toEqual(["qq", "tg"])
    expect(reg.get("qq")!.isConnected()).toBe(true)
    expect(reg.get("tg")!.isConnected()).toBe(true)
  })

  it("startAll 单通道失败不阻断其它,记 lastError", async () => {
    const reg = new ChannelRegistry()
    const qq = makeChannel("qq", { failStart: true })
    const tg = makeChannel("tg")
    reg.register(qq)
    reg.register(tg)
    const results = await reg.startAll()
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(qq.lastError).toContain("qq-boom")
    expect(tg.isConnected()).toBe(true)
    expect(qq.isConnected()).toBe(false)
  })

  it("stopAll 停止并清空", async () => {
    const reg = new ChannelRegistry()
    let stopped = 0
    reg.register(makeChannel("qq", { onStop: () => stopped++ }))
    await reg.startAll()
    await reg.stopAll()
    expect(stopped).toBe(1)
    expect(reg.get("qq")).toBeUndefined()
    expect(reg.status()).toEqual([])
  })

  it("status 汇总各通道", async () => {
    const reg = new ChannelRegistry()
    reg.register(makeChannel("qq"))
    await reg.startAll()
    const st = reg.status()
    expect(st).toEqual([{ id: "qq", connected: true, lastError: undefined }])
  })
})
