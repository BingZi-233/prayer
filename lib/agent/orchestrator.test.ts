import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { bus } from "../bus";
import { registerOrchestrator } from "./orchestrator";
import { registerReplyMapper } from "./reply-mapper";
import { SessionStore } from "./session";

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

  it("reply mapper: reply.ready → action.send", async () => {
    registerReplyMapper();
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("reply.ready", { groupId: 5, text: "hi" });
    const a = await p;
    expect(a).toEqual({ action: "send_group_msg", groupId: 5, text: "hi" });
  });
});
