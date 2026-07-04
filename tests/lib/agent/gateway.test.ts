import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { registerGateway } from "@/lib/agent/gateway";
import type { QualifiedMessage } from "@/lib/events";

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

  it("用户自助重置:@bot 发关键词 → 清 resumeId、回确认、不转 Agent", async () => {
    repo.setSessionId("1:2", "sid-old");
    const qualified = vi.fn();
    bus.on("message.qualified", qualified);
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 20, rawText: "重新开始", atList: [BOT] });
    const a = await p;
    expect(a.groupId).toBe(1);
    expect(a.text).toContain("重置");
    expect(repo.getResumeId("1:2")).toBeUndefined(); // 续接指针已清
    expect(repo.getSessionId("1:2")).toBe("sid-old"); // 展示指针保留,网页仍可查看
    expect(qualified).not.toHaveBeenCalled();
  });

  it("普通问题不被重置关键词误伤", async () => {
    const p = collectQualified();
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 21, rawText: "怎么重置密码", atList: [BOT] });
    const q = await p;
    expect(q.text).toBe("怎么重置密码");
  });

  it("管理群 !reset <key> → 清 resumeId 并回确认", async () => {
    repo.setSessionId("1:2", "sid-old");
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("message.received", { groupId: 999, userId: 7, messageId: 22, rawText: "!reset 1:2", atList: [BOT] });
    const a = await p;
    expect(a.groupId).toBe(999);
    expect(a.text).toContain("1:2");
    expect(repo.getResumeId("1:2")).toBeUndefined(); // 续接指针已清
    expect(repo.getSessionId("1:2")).toBe("sid-old"); // 展示指针保留
  });
});

describe("gateway 人工回复捕获(反思触发)", () => {
  it("人工接管期 owner 发言 → emit handoff.humanReply,带问题与答案,不进 Agent", async () => {
    repo.setHumanMode("1:2", true);
    repo.setHandoffQuestion("1:2", "退款多久到账?");
    const qualified = vi.fn();
    bus.on("message.qualified", qualified);
    const p = new Promise<any>((res) => bus.once("handoff.humanReply", res));
    // 群主(userId 7,非会话用户 2)在用户群回答,未 @bot
    bus.emit("message.received", { groupId: 1, userId: 7, messageId: 30, rawText: "退款一般 3 个工作日到账", atList: [], senderRole: "owner" });
    const e = await p;
    expect(e.sessionKey).toBe("1:2");
    expect(e.question).toBe("退款多久到账?");
    expect(e.answer).toBe("退款一般 3 个工作日到账");
    await new Promise((r) => setTimeout(r, 30));
    expect(qualified).not.toHaveBeenCalled(); // 人工回复不转 Agent
  });

  it("普通成员发言不触发", async () => {
    repo.setHumanMode("1:2", true);
    const spy = vi.fn();
    bus.on("handoff.humanReply", spy);
    bus.emit("message.received", { groupId: 1, userId: 7, messageId: 31, rawText: "我也想知道", atList: [], senderRole: "member" });
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
  });

  it("用户本人恰是群主不触发(userId==会话用户)", async () => {
    repo.setHumanMode("1:2", true);
    const spy = vi.fn();
    bus.on("handoff.humanReply", spy);
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 32, rawText: "在吗", atList: [], senderRole: "owner" });
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
  });

  it("! 开头的命令样式不当作人工答案", async () => {
    repo.setHumanMode("1:2", true);
    const spy = vi.fn();
    bus.on("handoff.humanReply", spy);
    bus.emit("message.received", { groupId: 1, userId: 7, messageId: 33, rawText: "!resume 1:2", atList: [], senderRole: "admin" });
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
  });

  it("群内无人工会话时不触发", async () => {
    const spy = vi.fn();
    bus.on("handoff.humanReply", spy);
    bus.emit("message.received", { groupId: 1, userId: 7, messageId: 34, rawText: "随便说说", atList: [], senderRole: "owner" });
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
  });
});
