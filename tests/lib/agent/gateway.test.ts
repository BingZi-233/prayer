import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { registerGateway, isAtTrigger } from "@/lib/agent/gateway";
import type { QualifiedMessage } from "@/lib/events";

let repo: Repo;
const BOT = 555;
const ADMIN = 888;

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
  registerGateway({
    repo,
    botQQ: BOT,
    extraAtQQs: [ADMIN],
    adminGroupId: 999,
    enabledGroups: [1],
    supportUrl: "https://example.com",
  });
});

function collectQualified(): Promise<QualifiedMessage> {
  return new Promise((res) => bus.once("message.qualified", res));
}

describe("isAtTrigger", () => {
  it("命中 botQQ", () => {
    expect(isAtTrigger([BOT], BOT, [])).toBe(true);
  });
  it("命中 extraAtQQs", () => {
    expect(isAtTrigger([ADMIN], BOT, [ADMIN])).toBe(true);
  });
  it("都不命中", () => {
    expect(isAtTrigger([123], BOT, [ADMIN])).toBe(false);
  });
  it("忽略 0 / 负数", () => {
    expect(isAtTrigger([0], BOT, [0, -1])).toBe(false);
  });
});

describe("gateway", () => {
  it("@bot 的群消息 → emit message.qualified,含 sessionKey 与去 @ 文本", async () => {
    const p = collectQualified();
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 10, rawText: "订单在哪", atList: [BOT] });
    const q = await p;
    expect(q.sessionKey).toBe("1:2");
    expect(q.text).toBe("订单在哪");
    expect(q.messageId).toBe(10); // 透传触发消息 id,供回复引用
  });

  it("@额外监听 QQ(群管理)也当作 bot 触发", async () => {
    const p = collectQualified();
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 102, rawText: "帮我看看", atList: [ADMIN] });
    const q = await p;
    expect(q.sessionKey).toBe("1:2");
    expect(q.text).toBe("帮我看看");
  });

  it("写入 lastQuestion 供会话列表预览", async () => {
    const p = collectQualified();
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 101, rawText: "多少钱", atList: [BOT] });
    await p;
    const s = repo.listSessions().find((x) => x.key === "1:2");
    expect(s?.lastQuestion).toBe("多少钱");
  });

  it("纯图消息(无文本)@bot 也放行,并透传 images/quoted/forwarded", async () => {
    const p = collectQualified();
    bus.emit("message.received", {
      groupId: 1,
      userId: 2,
      messageId: 40,
      rawText: "",
      atList: [BOT],
      images: [{ data: "AAAA", mediaType: "image/png" }],
      quoted: "张三: 原问题",
      forwarded: "A: x",
    });
    const q = await p;
    expect(q.text).toBe("");
    expect(q.images).toEqual([{ data: "AAAA", mediaType: "image/png" }]);
    expect(q.quoted).toBe("张三: 原问题");
    expect(q.forwarded).toBe("A: x");
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

  it("用户自助重置:@bot 发关键词 → 清 resumeId、回确认、不转 Agent", async () => {
    repo.setSessionId("1:2", "sid-old");
    const qualified = vi.fn();
    bus.on("message.qualified", qualified);
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 20, rawText: "重新开始", atList: [BOT] });
    const a = await p;
    expect(a.groupId).toBe(1);
    expect(a.text).toContain("重置");
    expect(a.replyToId).toBe(20); // 重置回复引用触发消息
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

  it("@bot 人工 → handoff.requested", async () => {
    const p = new Promise<any>((res) => bus.once("handoff.requested", res));
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 50, rawText: "人工", atList: [BOT] });
    const h = await p;
    expect(h.sessionKey).toBe("1:2");
    expect(h.groupId).toBe(1);
  });

  it("human-mode 会话丢弃 qualified", async () => {
    repo.setHumanMode("1:2", true);
    const spy = vi.fn();
    bus.on("message.qualified", spy);
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 51, rawText: "还在吗", atList: [BOT] });
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
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

  it("管理群 !resume <key> → handoff.resumed", async () => {
    const p = new Promise<any>((res) => bus.once("handoff.resumed", res));
    bus.emit("message.received", { groupId: 999, userId: 7, messageId: 23, rawText: "!resume 1:2", atList: [BOT] });
    const h = await p;
    expect(h.sessionKey).toBe("1:2");
    expect(h.by).toBe("admin");
  });

  it("非生效群 @bot 不触发", async () => {
    const spy = vi.fn();
    bus.on("message.qualified", spy);
    bus.emit("message.received", { groupId: 777, userId: 2, messageId: 30, rawText: "订单在哪", atList: [BOT] });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it("非生效群不影响管理群命令(adminGroup 豁免)", async () => {
    repo.setSessionId("1:2", "sid-old");
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("message.received", { groupId: 999, userId: 7, messageId: 31, rawText: "!reset 1:2", atList: [BOT] });
    const a = await p;
    expect(a.groupId).toBe(999);
    expect(repo.getResumeId("1:2")).toBeUndefined();
  });

  it("帮助关键词回用法", async () => {
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 60, rawText: "帮助", atList: [BOT] });
    const a = await p;
    expect(a.text).toContain("@我");
    expect(a.text).toContain("example.com");
  });
});
