import { describe, it, expect, afterEach } from "vitest"
import { WebSocketServer } from "ws"
import type { AddressInfo } from "node:net"
import { bus } from "@/lib/bus"
import { ChannelRegistry } from "@/lib/channels/registry"
import { QqChannel } from "@/lib/channels/qq"

let wss: WebSocketServer | undefined
let reg: ChannelRegistry | undefined

afterEach(async () => {
  await reg?.stopAll()
  reg = undefined
  wss?.close()
  wss = undefined
  bus.removeAllListeners()
})

function startServer(onConn: (ws: any) => void): Promise<number> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 }, () => {
      resolve((wss!.address() as AddressInfo).port)
    })
    wss.on("connection", onConn)
  })
}

describe("QqChannel + ChannelRegistry 出站", () => {
  it("registry 分发 action.send → send_group_msg", async () => {
    const gotAction = new Promise<any>((res) => {
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
})
