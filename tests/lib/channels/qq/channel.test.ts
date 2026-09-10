import { describe, it, expect, afterEach } from "vitest"
import { WebSocketServer, type WebSocket } from "ws"
import type { AddressInfo } from "node:net"
import { bus } from "@/lib/core/bus"
import { ChannelRegistry } from "@/lib/channels/registry"
import { QqChannel, formatQqDetail } from "@/lib/channels/qq"

let wss: WebSocketServer | undefined
let reg: ChannelRegistry | undefined

afterEach(async () => {
  await reg?.stopAll()
  reg = undefined
  wss?.close()
  wss = undefined
  bus.removeAllListeners()
})

function startServer(onConn: (ws: WebSocket) => void): Promise<number> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 }, () => {
      resolve((wss!.address() as AddressInfo).port)
    })
    wss.on("connection", onConn)
  })
}

describe("QqChannel + ChannelRegistry 出站", () => {
  it("registry 分发 action.send → send_group_msg", async () => {
    const gotAction = new Promise<{
      action: string
      params: { group_id: number; message: unknown }
    }>((res) => {
      startServer((ws) => {
        ws.on("message", (raw: Buffer) => res(JSON.parse(raw.toString())))
      }).then(async (port) => {
        reg = new ChannelRegistry()
        reg.register(new QqChannel(`ws://127.0.0.1:${port}`))
        await reg.startAll()
        // 等 WS open
        await new Promise((r) => setTimeout(r, 80))
        bus.emit("action.send", {
          channel: "qq",
          chatId: "9",
          text: "hello-via-registry",
        })
      })
    })
    const action = await gotAction
    expect(action.action).toBe("send_group_msg")
    expect(action.params.group_id).toBe(9)
    expect(action.params.message).toBe("hello-via-registry")
  })

  it("QqChannel 实现 Channel.send", async () => {
    const ch = new QqChannel("ws://127.0.0.1:1")
    expect(typeof ch.send).toBe("function")
    expect(ch.id).toBe("qq")
    // 未连接时 send 不抛
    await expect(
      ch.send({ channel: "qq", chatId: "1", text: "x" })
    ).resolves.toBeUndefined()
  })

  it("真实收到入站帧后 status().detail 含 rx=", async () => {
    const port = await startServer((ws) => {
      ws.send(
        JSON.stringify({
          post_type: "message",
          message_type: "group",
          group_id: 1,
          user_id: 2,
          message_id: 3,
          message: "hi",
        })
      )
    })
    reg = new ChannelRegistry()
    const ch = new QqChannel(`ws://127.0.0.1:${port}`)
    reg.register(ch)
    await reg.startAll()
    // 等 WS open + 消息推送 + enrich
    await new Promise((r) => setTimeout(r, 150))
    expect(ch.status().detail).toMatch(/rx=\d+s ago/)
  })
})

describe("formatQqDetail", () => {
  it("从未收到帧且无静默重连 → undefined", () => {
    expect(formatQqDetail({ staleReconnects: 0 })).toBeUndefined()
  })

  it("只有 lastRxAt → rx=Ns ago", () => {
    const now = 1_000_000
    const detail = formatQqDetail(
      { lastRxAt: now - 12_000, staleReconnects: 0 },
      now
    )
    expect(detail).toBe("rx=12s ago")
  })

  it("只有 staleReconnects → stale-reconnects=N", () => {
    const detail = formatQqDetail({ staleReconnects: 2 })
    expect(detail).toBe("stale-reconnects=2")
  })

  it("两者都有 → 空格连接", () => {
    const now = 1_000_000
    const detail = formatQqDetail(
      { lastRxAt: now - 12_000, staleReconnects: 2 },
      now
    )
    expect(detail).toBe("rx=12s ago stale-reconnects=2")
  })

  it("秒数取整走 Math.round（1600ms → 2s）", () => {
    const now = 1_000_000
    const detail = formatQqDetail(
      { lastRxAt: now - 1_600, staleReconnects: 0 },
      now
    )
    expect(detail).toBe("rx=2s ago")
  })
})
