import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { bus } from "@/lib/bus";
import { OneBotClient } from "@/lib/onebot/client";

let wss: WebSocketServer | undefined;
let client: OneBotClient | undefined;

afterEach(() => {
  client?.stop();
  wss?.close();
});

function startServer(onConn: (ws: any) => void): Promise<number> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 }, () => {
      resolve((wss!.address() as AddressInfo).port);
    });
    wss.on("connection", onConn);
  });
}

describe("OneBotClient", () => {
  it("收到群消息 → emit message.received", async () => {
    const port = await startServer((ws) => {
      ws.send(JSON.stringify({
        post_type: "message", message_type: "group",
        group_id: 1, user_id: 2, message_id: 3, message: "hi",
      }));
    });
    const received = new Promise((res) => bus.once("message.received", res));
    client = new OneBotClient(`ws://127.0.0.1:${port}`);
    client.start();
    const m: any = await received;
    expect(m.groupId).toBe(1);
  });

  it("连接 open/stop → onStatus 回调 + isConnected 反映状态", async () => {
    const statuses: boolean[] = [];
    const connected = new Promise<void>((res) => {
      startServer(() => {}).then((port) => {
        client = new OneBotClient(`ws://127.0.0.1:${port}`, undefined, (c) => {
          statuses.push(c);
          if (c) res();
        });
        client.start();
      });
    });
    await connected;
    expect(client!.isConnected()).toBe(true);
    expect(statuses).toContain(true);
    client!.stop();
    expect(client!.isConnected()).toBe(false);
    expect(statuses[statuses.length - 1]).toBe(false);
  });

  it("action.send → 对端收到 send_group_msg 动作", async () => {
    const gotAction = new Promise<any>((res) => {
      startServer((ws) => {
        ws.on("message", (raw: Buffer) => res(JSON.parse(raw.toString())));
      }).then((port) => {
        client = new OneBotClient(`ws://127.0.0.1:${port}`);
        client.start();
        setTimeout(() => bus.emit("action.send", { action: "send_group_msg", groupId: 9, text: "hello" }), 100);
      });
    });
    const action = await gotAction;
    expect(action.action).toBe("send_group_msg");
    expect(action.params.group_id).toBe(9);
    expect(action.params.message).toBe("hello");
  });
});
