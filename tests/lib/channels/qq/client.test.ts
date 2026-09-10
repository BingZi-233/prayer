import { describe, it, expect, afterEach } from "vitest"
import { WebSocketServer, type WebSocket } from "ws"
import type { AddressInfo } from "node:net"
import { bus } from "@/lib/core/bus"
import type { IncomingMessage } from "@/lib/events"
import { OneBotClient } from "@/lib/channels/qq/client"

// OneBot 服务端收到的 API 请求帧(测试断言用)
interface SentAction {
  action: string
  params: { group_id: number; message: unknown }
}

let wss: WebSocketServer | undefined
let client: OneBotClient | undefined

afterEach(() => {
  client?.stop()
  wss?.close()
})

function startServer(onConn: (ws: WebSocket) => void): Promise<number> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 }, () => {
      resolve((wss!.address() as AddressInfo).port)
    })
    wss.on("connection", onConn)
  })
}

describe("OneBotClient", () => {
  it("收到群消息 → emit message.received(channelized)", async () => {
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
    const received = new Promise((res) => bus.once("message.received", res))
    client = new OneBotClient(`ws://127.0.0.1:${port}`)
    client.start()
    const m = (await received) as IncomingMessage
    expect(m.channel).toBe("qq")
    expect(m.chatId).toBe("1")
    expect(m.userId).toBe("2")
    expect(m.messageId).toBe("3")
    expect(m.rawText).toBe("hi")
    expect(m.atList).toEqual([])
  })

  it("连接 open/stop → onStatus 回调 + isConnected 反映状态", async () => {
    const statuses: boolean[] = []
    const connected = new Promise<void>((res) => {
      startServer(() => {}).then((port) => {
        client = new OneBotClient(`ws://127.0.0.1:${port}`, undefined, (c) => {
          statuses.push(c)
          if (c) res()
        })
        client.start()
      })
    })
    await connected
    expect(client!.isConnected()).toBe(true)
    expect(statuses).toContain(true)
    client!.stop()
    expect(client!.isConnected()).toBe(false)
    expect(statuses[statuses.length - 1]).toBe(false)
  })

  it("client.send → 对端收到 send_group_msg", async () => {
    const gotAction = new Promise<SentAction>((res) => {
      startServer((ws) => {
        ws.on("message", (raw: Buffer) => res(JSON.parse(raw.toString())))
      }).then((port) => {
        client = new OneBotClient(`ws://127.0.0.1:${port}`)
        client.start()
        setTimeout(
          () =>
            client!.send({
              channel: "qq",
              chatId: "9",
              text: "hello",
            }),
          100
        )
      })
    })
    const action = await gotAction
    expect(action.action).toBe("send_group_msg")
    expect(action.params.group_id).toBe(9)
    expect(action.params.message).toBe("hello")
  })

  it("client.send 不订阅 bus：action.send 事件本身不触发 OneBot", async () => {
    let got: unknown
    const port = await startServer((ws) => {
      ws.on("message", (raw: Buffer) => {
        got = JSON.parse(raw.toString())
      })
    })
    client = new OneBotClient(`ws://127.0.0.1:${port}`)
    client.start()
    await new Promise((r) => setTimeout(r, 50))
    bus.emit("action.send", {
      channel: "qq",
      chatId: "9",
      text: "nope",
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(got).toBeUndefined()
  })

  it("client.send 带 replyToId → message 为 reply+text 消息段数组", async () => {
    const gotAction = new Promise<SentAction>((res) => {
      startServer((ws) => {
        ws.on("message", (raw: Buffer) => res(JSON.parse(raw.toString())))
      }).then((port) => {
        client = new OneBotClient(`ws://127.0.0.1:${port}`)
        client.start()
        setTimeout(
          () =>
            client!.send({
              channel: "qq",
              chatId: "9",
              text: "答案",
              replyToId: "3",
            }),
          100
        )
      })
    })
    const action = await gotAction
    expect(Array.isArray(action.params.message)).toBe(true)
    expect(action.params.message).toEqual([
      { type: "reply", data: { id: "3" } },
      { type: "text", data: { text: "答案" } },
    ])
  })

  it("getGroupList → 发 get_group_list 并按 echo 解析 data", async () => {
    const port = await startServer((ws) => {
      ws.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString())
        if (req.action === "get_group_list") {
          ws.send(
            JSON.stringify({
              echo: req.echo,
              data: [
                { group_id: 111, group_name: "群甲" },
                { group_id: 222, group_name: "群乙" },
              ],
            })
          )
        }
      })
    })
    client = new OneBotClient(`ws://127.0.0.1:${port}`)
    client.start()
    await new Promise((r) => setTimeout(r, 100)) // 等连接 open
    const list = await client.getGroupList()
    expect(Array.isArray(list)).toBe(true)
    expect((list as { group_id: number }[]).map((g) => g.group_id)).toEqual([
      111, 222,
    ])
  })

  it("getGroupList 未连接 → undefined", async () => {
    client = new OneBotClient("ws://127.0.0.1:1") // 不连
    const list = await client.getGroupList()
    expect(list).toBeUndefined()
  })

  it("getGroupMemberList → 发 get_group_member_list 并按 echo 解析 data", async () => {
    const port = await startServer((ws) => {
      ws.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString())
        if (req.action === "get_group_member_list") {
          ws.send(
            JSON.stringify({
              echo: req.echo,
              data: [
                { user_id: 5, card: "小明" },
                { user_id: 6, nickname: "阿花" },
              ],
            })
          )
        }
      })
    })
    client = new OneBotClient(`ws://127.0.0.1:${port}`)
    client.start()
    await new Promise((r) => setTimeout(r, 100))
    const list = await client.getGroupMemberList(111)
    expect((list as { user_id: number }[]).map((m) => m.user_id)).toEqual([
      5, 6,
    ])
  })

  it("getGroupMemberList 未连接 → undefined", async () => {
    client = new OneBotClient("ws://127.0.0.1:1")
    expect(await client.getGroupMemberList(111)).toBeUndefined()
  })

  it("open 后按 pingIntervalMs 主动发 ws ping", async () => {
    let pings = 0
    const port = await startServer((ws) => {
      ws.on("ping", () => {
        pings++
      })
    })
    client = new OneBotClient(`ws://127.0.0.1:${port}`, undefined, undefined, {
      pingIntervalMs: 30,
      // 不让看门狗在本例中开火
      livenessMs: 60_000,
    })
    client.start()
    await new Promise((r) => setTimeout(r, 200))
    expect(pings).toBeGreaterThanOrEqual(2)
  })

  it("服务端静默超过 livenessMs → terminate 并重新建连", async () => {
    let connections = 0
    const port = await startServer(() => {
      connections++
      // 建连后什么都不发，也不回 ping（pingIntervalMs 设得足够大，不会发出 ping）
    })
    client = new OneBotClient(`ws://127.0.0.1:${port}`, undefined, undefined, {
      pingIntervalMs: 60_000,
      livenessMs: 120,
    })
    client.start()
    // 首连 + 看门狗开火 + backoff 1000ms 后重连
    await new Promise((r) => setTimeout(r, 2500))
    expect(connections).toBeGreaterThanOrEqual(2)
    expect(client.stats().staleReconnects).toBeGreaterThanOrEqual(1)
  }, 10_000)

  it("heartbeat meta_event 不 emit 消息,且按 interval 收紧 deadline", async () => {
    let connections = 0
    let emitted = 0
    const onMsg = () => {
      emitted++
    }
    bus.on("message.received", onMsg)
    try {
      const port = await startServer((ws) => {
        connections++
        ws.send(
          JSON.stringify({
            post_type: "meta_event",
            meta_event_type: "heartbeat",
            interval: 20,
          })
        )
      })
      client = new OneBotClient(
        `ws://127.0.0.1:${port}`,
        undefined,
        undefined,
        {
          pingIntervalMs: 60_000,
          // 默认 deadline 很长；只有 retune 生效才会在测试窗口内开火
          livenessMs: 60_000,
          minLivenessMs: 10,
          heartbeatFactor: 3,
        }
      )
      client.start()
      await new Promise((r) => setTimeout(r, 2500))
      expect(connections).toBeGreaterThanOrEqual(2)
      expect(emitted).toBe(0)
    } finally {
      bus.off("message.received", onMsg)
    }
  }, 10_000)
})
