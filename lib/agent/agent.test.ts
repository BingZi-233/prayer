import { describe, it, expect } from "vitest";
import { Agent } from "./agent";

// 模拟 SDK query:产出 init(带 session_id)+ 一条 assistant 文本
async function* fakeQuery(_args: any) {
  yield { type: "system", subtype: "init", session_id: "sid-new" };
  yield { type: "assistant", message: { content: [{ type: "text", text: "你好,请问有什么可以帮您?" }] } };
  yield { type: "result", subtype: "success" };
}

describe("Agent.run", () => {
  it("返回最终文本 + 新 session_id", async () => {
    const agent = new Agent({ model: "claude-sonnet-5", systemPrompt: "客服", toolServer: {} as any, queryFn: fakeQuery as any });
    const out = await agent.run("在吗", undefined);
    expect(out.text).toContain("有什么可以帮您");
    expect(out.sessionId).toBe("sid-new");
  });

  it("传入 resumeId 时透传给 options.resume", async () => {
    let seen: any;
    const spyQuery = async function* (args: any) {
      seen = args;
      yield { type: "system", subtype: "init", session_id: "sid-x" };
      yield { type: "result", subtype: "success" };
    };
    const agent = new Agent({ model: "m", systemPrompt: "s", toolServer: {} as any, queryFn: spyQuery as any });
    await agent.run("hi", "sid-prev");
    expect(seen.options.resume).toBe("sid-prev");
  });
});
