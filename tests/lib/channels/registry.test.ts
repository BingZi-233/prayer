import { describe, it, expect, afterEach } from "vitest"
import { bus } from "@/lib/core/bus"
import { ChannelRegistry } from "@/lib/channels/registry"
import type {
  Channel,
  ChannelCapabilities,
  ChannelId,
} from "@/lib/core/chat/types"
import type { ActionSend } from "@/lib/core/chat/events"

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
    onSend?: (a: ActionSend) => void | Promise<void>
    isBypassEnabled?: (chatId: string) => boolean
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
    async send(a: ActionSend) {
      await opts.onSend?.(a)
    },
    isBypassEnabled: opts.isBypassEnabled,
  }
}

afterEach(() => {
  bus.removeAllListeners()
})

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
    reg.register(makeChannel("qq", { onStart: () => order.push("qq") }))
    reg.register(makeChannel("tg", { onStart: () => order.push("tg") }))
    const results = await reg.startAll()
    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    expect(order.sort()).toEqual(["qq", "tg"])
    expect(reg.get("qq")!.isConnected()).toBe(true)
    expect(reg.get("tg")!.isConnected()).toBe(true)
    await reg.stopAll()
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
    await reg.stopAll()
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
    await reg.stopAll()
  })

  it("action.send 经 registry 路由到匹配 channel.send", async () => {
    const reg = new ChannelRegistry()
    const sent: ActionSend[] = []
    reg.register(
      makeChannel("qq", {
        onSend: (a) => {
          sent.push(a)
        },
      })
    )
    reg.register(
      makeChannel("tg", {
        onSend: () => {
          throw new Error("tg should not receive qq action")
        },
      })
    )
    await reg.startAll()

    bus.emit("action.send", {
      channel: "qq",
      chatId: "1",
      text: "hello",
      replyToId: "9",
    })
    // dispatch 是 async void
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      channel: "qq",
      chatId: "1",
      text: "hello",
      replyToId: "9",
    })
    await reg.stopAll()
  })

  it("未注册 channel 的 action.send → error.occurred(channel.unregistered)，不静默", async () => {
    const reg = new ChannelRegistry()
    reg.register(makeChannel("qq"))
    await reg.startAll()

    const err = new Promise<{ scope: string; channel?: string }>((res) =>
      bus.once("error.occurred", (e) =>
        res(e as { scope: string; channel?: string })
      )
    )
    bus.emit("action.send", {
      channel: "tg",
      chatId: "-100",
      text: "orphan",
    })
    const e = await err
    expect(e.scope).toBe("channel.unregistered")
    expect(e.channel).toBe("tg")
    await reg.stopAll()
  })

  it("stopAll 后 action.send 不再分发到已清通道", async () => {
    const reg = new ChannelRegistry()
    let n = 0
    reg.register(
      makeChannel("qq", {
        onSend: () => {
          n++
        },
      })
    )
    await reg.startAll()
    await reg.stopAll()
    bus.emit("action.send", { channel: "qq", chatId: "1", text: "x" })
    await new Promise((r) => setTimeout(r, 20))
    expect(n).toBe(0)
  })

  it("isBypassEnabled 委托 channel；未实现则 true", () => {
    const reg = new ChannelRegistry()
    reg.register(
      makeChannel("tg", {
        isBypassEnabled: (chatId) => chatId !== "blocked",
      })
    )
    reg.register(makeChannel("qq"))
    expect(reg.isBypassEnabled("tg", "ok")).toBe(true)
    expect(reg.isBypassEnabled("tg", "blocked")).toBe(false)
    expect(reg.isBypassEnabled("qq", "any")).toBe(true)
    // 未注册
    expect(reg.isBypassEnabled("discord", "x")).toBe(true)
  })
})
