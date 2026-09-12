import { describe, it, expect, afterEach } from "vitest"
import { bus } from "@/lib/core/bus"
import { ChannelRegistry } from "@/lib/channels/registry"
import type {
  Channel,
  ChannelCapabilities,
  ChannelId,
} from "@/lib/core/chat/types"
import type { ActionSend } from "@/lib/core/chat/events"
import type { OutboundStore, OutboxRecord } from "@/lib/core/chat/outbox"

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
  it("未注册 channel 的持久化失败必须带 lease token，防止旧 worker 覆盖重试", async () => {
    let marked: { id: number; token?: string | null } | undefined
    const claimed: OutboxRecord = {
      id: 7,
      deliveryKey: "delivery-7",
      action: {
        channel: "tg",
        chatId: "-100",
        text: "orphan",
        deliveryKey: "delivery-7",
      },
      status: "sending",
      attempts: 1,
      nextAttemptAt: 0,
      leaseUntil: 30_000,
      claimToken: "lease-7",
      lastError: null,
    }
    const outbox: OutboundStore = {
      enqueueAndClaim: () => claimed,
      claimDue: () => [],
      markSent: () => true,
      markFailed: (id, _error, _nextAttemptAt, token) => {
        marked = { id, token }
        return true
      },
      sentChunkCount: () => 0,
    }
    const reg = new ChannelRegistry({ outbox })

    await reg.dispatch(claimed.action)

    expect(marked).toEqual({ id: 7, token: "lease-7" })
  })

  it("旧 lease 的发送完成不会伪造 delivery.sent", async () => {
    const events: unknown[] = []
    const onDelivery = (e: unknown) => events.push(e)
    bus.on("delivery.recorded", onDelivery as never)
    const claimed: OutboxRecord = {
      id: 8,
      deliveryKey: "delivery-8",
      action: {
        channel: "qq",
        chatId: "1",
        text: "stale",
        deliveryKey: "delivery-8",
      },
      status: "sending",
      attempts: 1,
      nextAttemptAt: 0,
      leaseUntil: 30_000,
      claimToken: "lease-8",
      lastError: null,
    }
    const outbox: OutboundStore = {
      enqueueAndClaim: () => claimed,
      claimDue: () => [],
      markSent: () => false,
      markFailed: () => false,
      sentChunkCount: () => 0,
    }
    const reg = new ChannelRegistry({ outbox })
    reg.register(makeChannel("qq"))

    await reg.dispatch(claimed.action)

    bus.off("delivery.recorded", onDelivery as never)
    expect(events).toHaveLength(0)
  })

  it("retryDue 发送成功/失败都沿用 lease token，旧 lease 写入失败时不记 delivery", async () => {
    const action: ActionSend = {
      channel: "tg",
      chatId: "-100",
      text: "retry",
      deliveryKey: "delivery-retry",
      resolutionKey: "resolution-retry",
    }
    const makeRecord = (id: number, token: string): OutboxRecord => ({
      id,
      deliveryKey: action.deliveryKey!,
      action,
      status: "sending",
      attempts: 2,
      nextAttemptAt: 0,
      leaseUntil: 30_000,
      claimToken: token,
      lastError: null,
    })

    const sent: { id: number; token?: string | null }[] = []
    const sentOutbox: OutboundStore = {
      enqueueAndClaim: () => null,
      claimDue: () => [makeRecord(11, "lease-success")],
      markSent: (id, _at, token) => {
        sent.push({ id, token })
        return true
      },
      markFailed: () => true,
      sentChunkCount: () => 0,
    }
    const successful = new ChannelRegistry({ outbox: sentOutbox })
    const sends: ActionSend[] = []
    successful.register(
      makeChannel("tg", {
        onSend: (a) => {
          sends.push(a)
        },
      })
    )
    const successEvents: unknown[] = []
    const onSuccess = (e: unknown) => successEvents.push(e)
    bus.on("delivery.recorded", onSuccess as never)
    await (successful as unknown as { retryDue: () => Promise<void> }).retryDue()
    bus.off("delivery.recorded", onSuccess as never)

    expect(sends).toEqual([action])
    expect(sent).toEqual([{ id: 11, token: "lease-success" }])
    expect(successEvents).toEqual([
      expect.objectContaining({
        deliveryKey: action.deliveryKey,
        status: "sent",
      }),
    ])

    const failed: { id: number; token?: string | null }[] = []
    const failedOutbox: OutboundStore = {
      enqueueAndClaim: () => null,
      claimDue: () => [makeRecord(12, "lease-failure")],
      markSent: () => true,
      markFailed: (id, _error, _nextAttemptAt, token) => {
        failed.push({ id, token })
        return true
      },
      sentChunkCount: () => 0,
    }
    const failing = new ChannelRegistry({ outbox: failedOutbox })
    failing.register(
      makeChannel("tg", {
        onSend: () => {
          throw new Error("temporary send failure")
        },
      })
    )
    const failureEvents: unknown[] = []
    const onFailure = (e: unknown) => failureEvents.push(e)
    bus.on("delivery.recorded", onFailure as never)
    await (failing as unknown as { retryDue: () => Promise<void> }).retryDue()
    bus.off("delivery.recorded", onFailure as never)

    expect(failed).toEqual([{ id: 12, token: "lease-failure" }])
    expect(failureEvents).toEqual([
      expect.objectContaining({
        deliveryKey: action.deliveryKey,
        status: "failed",
        error: "temporary send failure",
      }),
    ])

    const staleEvents: unknown[] = []
    const onStale = (e: unknown) => staleEvents.push(e)
    bus.on("delivery.recorded", onStale as never)
    const staleOutbox: OutboundStore = {
      enqueueAndClaim: () => null,
      claimDue: () => [makeRecord(13, "lease-stale")],
      markSent: (id, _at, token) => {
        sent.push({ id, token })
        return false
      },
      markFailed: () => true,
      sentChunkCount: () => 0,
    }
    const stale = new ChannelRegistry({ outbox: staleOutbox })
    stale.register(makeChannel("tg"))
    await (stale as unknown as { retryDue: () => Promise<void> }).retryDue()
    bus.off("delivery.recorded", onStale as never)

    expect(sent).toContainEqual({ id: 13, token: "lease-stale" })
    expect(staleEvents).toHaveLength(0)
  })

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
