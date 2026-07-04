import { describe, it, expect } from "vitest";
import { Agent, isPackyCommand, isToolAllowed } from "@/lib/agent/agent";
import { TOOL_NAMES } from "@/lib/tools/index";

// 模拟 SDK query:产出 init(带 session_id)+ 一条 assistant 文本
async function* fakeQuery(_args: any) {
  yield { type: "system", subtype: "init", session_id: "sid-new" };
  yield { type: "assistant", message: { content: [{ type: "text", text: "你好,请问有什么可以帮您?" }] } };
  yield { type: "result", subtype: "success" };
}

describe("Agent.run", () => {
  it("返回最终文本 + 新 session_id", async () => {
    const agent = new Agent({ model: "claude-sonnet-5", systemPrompt: "客服", makeToolServer: () => ({}), queryFn: fakeQuery as any });
    const out = await agent.run("在吗", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 });
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
    const agent = new Agent({ model: "m", systemPrompt: "s", makeToolServer: () => ({}), queryFn: spyQuery as any });
    await agent.run("hi", "sid-prev", { sessionKey: "1:2", groupId: 1, userId: 2 });
    expect(seen.options.resume).toBe("sid-prev");
  });
});

describe("isToolAllowed", () => {
  it("白名单工具放行:cs 三工具 + WebSearch", () => {
    for (const t of TOOL_NAMES) expect(isToolAllowed(t, {})).toBe(true);
    expect(isToolAllowed("WebSearch", {})).toBe(true);
  });
  it("Bash 仅放行 packy 脚本", () => {
    expect(isToolAllowed("Bash", { command: "node /a/packy.ts models" })).toBe(true);
    expect(isToolAllowed("Bash", { command: "rm -rf /" })).toBe(false);
    expect(isToolAllowed("Bash", { command: "node /a/packy.ts; rm -rf /" })).toBe(false);
  });
  it("其余工具拒绝", () => {
    expect(isToolAllowed("Read", {})).toBe(false);
    expect(isToolAllowed("Write", { file_path: "/x" })).toBe(false);
    expect(isToolAllowed("WebFetch", { url: "http://x" })).toBe(false);
  });
});

describe("isPackyCommand", () => {
  it("放行正常 packy 查询", () => {
    expect(isPackyCommand('node "/root/.claude/plugins/packyapi/scripts/packy.ts" models --endpoint anthropic')).toBe(true);
    expect(isPackyCommand("node /a/b/packy.ts price claude --group cc")).toBe(true);
  });
  it("拒绝 shell 链接 / 重定向 / 子命令(防注入)", () => {
    expect(isPackyCommand("node /a/packy.ts models; rm -rf /")).toBe(false);
    expect(isPackyCommand("node /a/packy.ts && cat /etc/passwd")).toBe(false);
    expect(isPackyCommand("node /a/packy.ts `whoami`")).toBe(false);
    expect(isPackyCommand("node /a/packy.ts $(id)")).toBe(false);
    expect(isPackyCommand("node /a/packy.ts models > /tmp/x")).toBe(false);
  });
  it("拒绝非 packy 命令", () => {
    expect(isPackyCommand("node /a/other.ts")).toBe(false);
    expect(isPackyCommand("rm -rf /")).toBe(false);
    expect(isPackyCommand("cat packy.ts")).toBe(false);
  });
});
