import { describe, it, expect } from "vitest";
import { Agent, isPackyCommand, isPackyRefPath, isPackyUrl, isToolAllowed, sdkEnv } from "@/lib/agent/agent";

// 模拟 SDK query:产出 init(带 session_id)+ 一条 assistant 文本
async function* fakeQuery(_args: any) {
  yield { type: "system", subtype: "init", session_id: "sid-new" };
  yield { type: "assistant", message: { content: [{ type: "text", text: "你好,请问有什么可以帮您?" }] } };
  yield { type: "result", subtype: "success" };
}

describe("Agent.run", () => {
  it("返回最终文本 + 新 session_id", async () => {
    const agent = new Agent({systemPrompt: "客服", queryFn: fakeQuery as any });
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
    const agent = new Agent({systemPrompt: "s", queryFn: spyQuery as any });
    await agent.run("hi", "sid-prev", { sessionKey: "1:2", groupId: 1, userId: 2 });
    expect(seen.options.resume).toBe("sid-prev");
  });

  it("pluginPaths 转成 options.plugins 的 local 项(开启 MCP 发现,不设 skipMcpDiscovery)", async () => {
    let seen: any;
    const spyQuery = async function* (args: any) {
      seen = args;
      yield { type: "result", subtype: "success" };
    };
    const agent = new Agent({
      systemPrompt: "s",
      pluginPaths: ["/abs/plugins/packyapi"],
      queryFn: spyQuery as any,
    });
    await agent.run("hi", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 });
    expect(seen.options.plugins).toEqual([{ type: "local", path: "/abs/plugins/packyapi" }]);
  });

  it("未给 pluginPaths 时 options.plugins 为空数组", async () => {
    let seen: any;
    const spyQuery = async function* (args: any) {
      seen = args;
      yield { type: "result", subtype: "success" };
    };
    const agent = new Agent({systemPrompt: "s", queryFn: spyQuery as any });
    await agent.run("hi", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 });
    expect(seen.options.plugins).toEqual([]);
  });

  it("无图:prompt 为字符串(向后兼容)", async () => {
    let seen: any;
    const spyQuery = async function* (args: any) {
      seen = args;
      yield { type: "result", subtype: "success" };
    };
    const agent = new Agent({systemPrompt: "s", queryFn: spyQuery as any });
    await agent.run("在吗", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 });
    expect(seen.prompt).toBe("在吗");
  });

  it("引用/转发折叠进文本前言(无图仍字符串)", async () => {
    let seen: any;
    const spyQuery = async function* (args: any) {
      seen = args;
      yield { type: "result", subtype: "success" };
    };
    const agent = new Agent({systemPrompt: "s", queryFn: spyQuery as any });
    await agent.run("这是啥", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 }, { quoted: "张三: 原问题", forwarded: "A: x\nB: y" });
    expect(seen.prompt).toContain("【用户引用了一条消息:张三: 原问题】");
    expect(seen.prompt).toContain("【用户转发的合并消息:");
    expect(seen.prompt).toContain("这是啥");
  });

  it("有图:prompt 为 AsyncIterable,首条含 image block(base64)+ 文本", async () => {
    let seen: any;
    const spyQuery = async function* (args: any) {
      seen = args;
      yield { type: "result", subtype: "success" };
    };
    const agent = new Agent({systemPrompt: "s", queryFn: spyQuery as any });
    await agent.run("看图", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 }, {
      images: [{ data: "AAAA", mediaType: "image/png" }],
    });
    expect(typeof seen.prompt[Symbol.asyncIterator]).toBe("function");
    const first = (await seen.prompt[Symbol.asyncIterator]().next()).value;
    expect(first.type).toBe("user");
    expect(first.message.role).toBe("user");
    const content = first.message.content;
    expect(content[0]).toEqual({ type: "text", text: "看图" });
    expect(content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
  });
});

describe("Agent.run systemSuffix", () => {
  it("传 systemSuffix → 拼接进 systemPrompt", async () => {
    let captured: any;
    const queryFn = ((args: any) => {
      captured = args;
      return (async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
      })();
    }) as any;
    const agent = new Agent({
      systemPrompt: "BASE",
      queryFn,
    });
    await agent.run("hi", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 }, undefined, {
      systemSuffix: "SENTINEL_RULE",
    });
    expect(captured.options.systemPrompt).toContain("BASE");
    expect(captured.options.systemPrompt).toContain("SENTINEL_RULE");
  });

  it("不传 opts → systemPrompt 不含额外后缀(行为不变)", async () => {
    let captured: any;
    const queryFn = ((args: any) => {
      captured = args;
      return (async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
      })();
    }) as any;
    const agent = new Agent({systemPrompt: "BASE", queryFn });
    await agent.run("hi", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 });
    expect(captured.options.systemPrompt).toBe("BASE");
  });
});

describe("sdkEnv", () => {
  it("剥掉所有 ANTHROPIC_* 让 settings.json 的 env 接管", () => {
    const out = sdkEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      CLAUDE_CONFIG_DIR: "/abs/data/claude-config",
      ANTHROPIC_BASE_URL: "https://www.packyapi.com",
      ANTHROPIC_AUTH_TOKEN: "leak",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "x",
    });
    expect(out.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(out.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    // 保留 CONFIG_DIR 与必需变量
    expect(out.CLAUDE_CONFIG_DIR).toBe("/abs/data/claude-config");
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/home/x");
  });
  it("丢弃 undefined 值", () => {
    const out = sdkEnv({ A: "1", B: undefined });
    expect(out).toEqual({ A: "1" });
  });
});

describe("Agent.run env", () => {
  it("options.env 剥掉 ANTHROPIC_*(不 shadow settings.json)", async () => {
    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://inherited.example";
    let seen: any;
    const spyQuery = async function* (args: any) {
      seen = args;
      yield { type: "result", subtype: "success" };
    };
    const agent = new Agent({systemPrompt: "s", queryFn: spyQuery as any });
    await agent.run("hi", undefined, { sessionKey: "1:2", groupId: 1, userId: 2 });
    expect(seen.options.env.ANTHROPIC_BASE_URL).toBeUndefined();
    if (prev === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prev;
  });
});

describe("isToolAllowed", () => {
  it("白名单工具放行:cs kb_search + packyapi + WebSearch + Skill", () => {
    expect(isToolAllowed("mcp__plugin_cs_cs__kb_search", {})).toBe(true);
    expect(isToolAllowed("mcp__plugin_packyapi_packyapi__packy", {})).toBe(true);
    expect(isToolAllowed("WebSearch", {})).toBe(true);
    expect(isToolAllowed("Skill", { command: "packyapi" })).toBe(true);
  });
  it("Bash 仅放行 packy 脚本", () => {
    expect(isToolAllowed("Bash", { command: "node /a/packy.ts models" })).toBe(true);
    expect(isToolAllowed("Bash", { command: "rm -rf /" })).toBe(false);
    expect(isToolAllowed("Bash", { command: "node /a/packy.ts; rm -rf /" })).toBe(false);
  });
  it("Read 仅放行 packy references,WebFetch 仅放行 packyapi.com", () => {
    expect(isToolAllowed("Read", { file_path: "/x/plugins/packyapi/skills/packyapi/references/docs-map.md" })).toBe(true);
    expect(isToolAllowed("Read", { file_path: "/etc/passwd" })).toBe(false);
    expect(isToolAllowed("Read", { file_path: "./data/claude-config/settings.json" })).toBe(false);
    expect(isToolAllowed("WebFetch", { url: "https://www.packyapi.com/docs/x" })).toBe(true);
    expect(isToolAllowed("WebFetch", { url: "https://evil.com/x" })).toBe(false);
  });
  it("其余工具拒绝", () => {
    expect(isToolAllowed("Write", { file_path: "/x" })).toBe(false);
    expect(isToolAllowed("Task", {})).toBe(false);
    expect(isToolAllowed("Edit", { file_path: "/x" })).toBe(false);
  });
});

describe("isPackyRefPath / isPackyUrl", () => {
  it("references 路径", () => {
    expect(isPackyRefPath("/a/packyapi/0.1.0/skills/packyapi/references/docs-map.md")).toBe(true);
    expect(isPackyRefPath("/a/packyapi/references/pricing-api.md")).toBe(true);
    expect(isPackyRefPath("/a/packyapi/scripts/packy.ts")).toBe(false);
    expect(isPackyRefPath("/a/other/references/x.md")).toBe(false);
  });
  it("packyapi 域名", () => {
    expect(isPackyUrl("https://packyapi.com/api/pricing")).toBe(true);
    expect(isPackyUrl("https://www.packyapi.com/docs")).toBe(true);
    expect(isPackyUrl("https://docs.packyapi.com/docs/token/2-group.html")).toBe(true);
    expect(isPackyUrl("https://packyapi.com.evil.com/x")).toBe(false);
    expect(isPackyUrl("https://notpackyapi.com/x")).toBe(false);
    expect(isPackyUrl("not-a-url")).toBe(false);
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
