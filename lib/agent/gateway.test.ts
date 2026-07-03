import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { bus } from "../bus";
import { registerGateway } from "./gateway";
import type { QualifiedMessage } from "../events";

let repo: Repo;
const BOT = 555;

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
  registerGateway({ repo, botQQ: BOT, adminGroupId: 999 });
});

function collectQualified(): Promise<QualifiedMessage> {
  return new Promise((res) => bus.once("message.qualified", res));
}

describe("gateway", () => {
  it("@bot 的群消息 → emit message.qualified,含 sessionKey 与去 @ 文本", async () => {
    const p = collectQualified();
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 10, rawText: "订单在哪", atList: [BOT] });
    const q = await p;
    expect(q.sessionKey).toBe("1:2");
    expect(q.text).toBe("订单在哪");
  });

  it("未 @bot 不触发", async () => {
    const spy = vi.fn();
    bus.on("message.qualified", spy);
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 11, rawText: "闲聊", atList: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it("重复 message_id 只触发一次", async () => {
    const spy = vi.fn();
    bus.on("message.qualified", spy);
    const msg = { groupId: 1, userId: 2, messageId: 12, rawText: "x", atList: [BOT] };
    bus.emit("message.received", msg);
    bus.emit("message.received", msg);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("human-mode 会话被丢弃", async () => {
    repo.setHumanMode("1:2", true);
    const spy = vi.fn();
    bus.on("message.qualified", spy);
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 13, rawText: "x", atList: [BOT] });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it("管理群 !resume <key> → emit handoff.resumed", async () => {
    const p = new Promise<any>((res) => bus.once("handoff.resumed", res));
    bus.emit("message.received", { groupId: 999, userId: 7, messageId: 14, rawText: "!resume 1:2", atList: [BOT] });
    const r = await p;
    expect(r.sessionKey).toBe("1:2");
  });
});
