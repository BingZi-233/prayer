import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { registerReflectionHandler } from "@/lib/agent/reflection-handler";

let repo: Repo;
const embed = async () => new Float32Array([1, 0, 0]); // 与 openDb(:memory:,3) 维度一致

// 造一个产出单条 assistant 文本的假 query
function fakeQuery(text: string) {
  return async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text }] } };
    yield { type: "result", subtype: "success" };
  };
}

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:", 3));
});

describe("reflection handler", () => {
  it("learn=true → 提炼入 KB(source 打标签)+ 通知管理群", async () => {
    const stop = registerReflectionHandler({
      repo,
      adminGroupId: 999,
      embed,
      now: () => 111,
      queryFn: fakeQuery('{"learn": true, "faq": "退款一般 3 个工作日到账"}') as never,
    });
    const notice = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("handoff.humanReply", { sessionKey: "1:2", question: "退款多久?", answer: "3 个工作日" });
    const a = await notice;
    expect(a.groupId).toBe(999);
    // 库里应能检索到该 FAQ
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 1);
    expect(hits[0].content).toContain("退款");
    expect(hits[0].source).toBe("human-reflection:1:2:111");
    stop();
  });

  it("learn=false → 不写库、不通知", async () => {
    const stop = registerReflectionHandler({
      repo,
      adminGroupId: 999,
      embed,
      queryFn: fakeQuery('{"learn": false}') as never,
    });
    const spy = vi.fn();
    bus.on("action.send", spy);
    bus.emit("handoff.humanReply", { sessionKey: "1:2", question: "在吗", answer: "在的亲" });
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0);
    stop();
  });

  it("输出非 JSON → 当作不学习,不写库", async () => {
    const stop = registerReflectionHandler({
      repo,
      adminGroupId: 999,
      embed,
      queryFn: fakeQuery("抱歉我无法处理") as never,
    });
    bus.emit("handoff.humanReply", { sessionKey: "1:2", question: "q", answer: "a" });
    await new Promise((r) => setTimeout(r, 30));
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0);
    stop();
  });

  it("query 抛错 → emit error.occurred,不抛出", async () => {
    const stop = registerReflectionHandler({
      repo,
      adminGroupId: 999,
      embed,
      queryFn: (() => {
        throw new Error("boom");
      }) as never,
    });
    const p = new Promise<any>((res) => bus.once("error.occurred", res));
    bus.emit("handoff.humanReply", { sessionKey: "1:2", question: "q", answer: "a" });
    const e = await p;
    expect(e.scope).toBe("reflection");
    expect(e.sessionKey).toBe("1:2");
    stop();
  });
});
