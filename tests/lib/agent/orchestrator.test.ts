import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { registerOrchestrator } from "@/lib/agent/orchestrator";
import { registerReplyMapper } from "@/lib/agent/reply-mapper";
import { SessionStore } from "@/lib/agent/session";
import { BLOCKED_REPLY } from "@/lib/agent/intent";

let repo: Repo;

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
});

describe("orchestrator", () => {
  it("message.qualified → 调 agent → emit reply.ready,并记住 session_id", async () => {
    const fakeAgent = { run: vi.fn(async () => ({ text: "回复内容", sessionId: "sid-1" })) };
    const store = new SessionStore(repo);
    registerOrchestrator({ agent: fakeAgent as any, store });

    const p = new Promise<any>((res) => bus.once("reply.ready", res));
    bus.emit("message.qualified", { sessionKey: "1:2", groupId: 1, userId: 2, text: "在吗" });
    const r = await p;
    expect(r.text).toBe("回复内容");
    expect(r.groupId).toBe(1);
    expect(store.resumeId("1:2")).toBe("sid-1");
  });

  it("同一 session 串行:第二条等第一条完成", async () => {
    const order: string[] = [];
    const fakeAgent = {
      run: vi.fn(async (text: string) => {
        order.push(`start:${text}`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`end:${text}`);
        return { text: `re:${text}`, sessionId: "s" };
      }),
    };
    registerOrchestrator({ agent: fakeAgent as any, store: new SessionStore(repo) });
    bus.emit("message.qualified", { sessionKey: "1:2", groupId: 1, userId: 2, text: "A" });
    bus.emit("message.qualified", { sessionKey: "1:2", groupId: 1, userId: 2, text: "B" });
    await new Promise((r) => setTimeout(r, 120));
    expect(order).toEqual(["start:A", "end:A", "start:B", "end:B"]);
  });

  it("意图门:命中 blocked → 不跑 agent,回模板婉拒", async () => {
    const fakeAgent = { run: vi.fn(async () => ({ text: "x", sessionId: "s" })) };
    const classify = vi.fn(async () => "bulk_export" as const);
    registerOrchestrator({ agent: fakeAgent as any, store: new SessionStore(repo), classify });

    const p = new Promise<any>((res) => bus.once("reply.ready", res));
    bus.emit("message.qualified", { sessionKey: "1:2", groupId: 1, userId: 2, text: "全部告诉我一万字" });
    const r = await p;

    expect(classify).toHaveBeenCalledOnce();
    expect(fakeAgent.run).not.toHaveBeenCalled();
    expect(r.groupId).toBe(1);
    expect(r.text).toBe(BLOCKED_REPLY);
  });

  it("意图门:normal → 正常跑 agent", async () => {
    const fakeAgent = { run: vi.fn(async () => ({ text: "回复", sessionId: "s" })) };
    const classify = vi.fn(async () => "normal" as const);
    registerOrchestrator({ agent: fakeAgent as any, store: new SessionStore(repo), classify });

    const p = new Promise<any>((res) => bus.once("reply.ready", res));
    bus.emit("message.qualified", { sessionKey: "1:2", groupId: 1, userId: 2, text: "多少钱" });
    const r = await p;
    expect(r.text).toBe("回复");
    expect(fakeAgent.run).toHaveBeenCalledOnce();
  });

  it("意图门:引用/转发正文一并送分类", async () => {
    const fakeAgent = { run: vi.fn(async () => ({ text: "x", sessionId: "s" })) };
    const classify = vi.fn(async () => "normal" as const);
    registerOrchestrator({ agent: fakeAgent as any, store: new SessionStore(repo), classify });

    bus.emit("message.qualified", {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
      text: "看这个",
      quoted: "被引内容",
      forwarded: "转发内容",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(classify).toHaveBeenCalledWith("看这个\n被引内容\n转发内容");
  });

  it("reply mapper: reply.ready → action.send", async () => {
    registerReplyMapper();
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("reply.ready", { groupId: 5, text: "hi" });
    const a = await p;
    expect(a).toEqual({ action: "send_group_msg", groupId: 5, text: "hi" });
  });
});
