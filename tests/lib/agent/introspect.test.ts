import { describe, it, expect } from "vitest";
import { buildToolPolicy } from "@/lib/agent/introspect";

describe("buildToolPolicy", () => {
  it("放行规则条恒在;无 liveTools 时 gated 仅兜底规则条", () => {
    const p = buildToolPolicy();
    expect(p.allowlist[0]).toContain("mcp__*");
    expect(p.allowlist[0]).toContain("Skill"); // 规则条含 TOOL_ALLOWLIST 内容
    expect(p.gated).toHaveLength(1);
    expect(p.gated[0].tool).toContain("其余一切工具");
  });

  it("liveTools 经 isToolAllowed 分区:mcp__/Skill 进 allowlist,其余进 gated", () => {
    const p = buildToolPolicy(["mcp__plugin_cs_cs__kb_search", "Skill", "Bash", "WebSearch"]);
    expect(p.allowlist).toContain("mcp__plugin_cs_cs__kb_search");
    expect(p.allowlist).toContain("Skill");
    const gatedTools = p.gated.map((g) => g.tool);
    expect(gatedTools).toContain("Bash");
    expect(gatedTools).toContain("WebSearch");
    expect(gatedTools).not.toContain("mcp__plugin_cs_cs__kb_search");
    // 末条恒为允许制兜底
    expect(gatedTools[gatedTools.length - 1]).toContain("其余一切工具");
  });
});

import { probeCapabilities, type ProbeOptions } from "@/lib/agent/introspect";
import type { AppConfig } from "@/lib/config-store";

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "",
  botQQ: 1,
  extraAtQQs: [],
  adminGroupId: 2,
  enabledGroups: [],
  proactiveEnabled: false,
  proactiveScanMs: 60000,
  proactiveSilenceMs: 180000,
  proactiveMaxPerScan: 2,
  handoffTimeoutMin: 30,
  dbPath: ":memory:",
  claudeConfigDir: "/tmp/cfgdir-test",
  reflectScanMs: 300000,
  reflectLookbackMs: 7200000,
  reflectSettleMs: 600000,
  reflectWindowMax: 60,
  reflectCompactMs: 86_400_000,
  reflectCompactMinEntries: 10,
  reflectNotifyAdmin: true,
  resumeTtlMs: 300000,
  supportUrl: "https://www.packyapi.com",
  ackEnabled: true,
  maxReplyChars: 900,
  usageBudgetUsd: 0,
  groupPolicies: {},
};

// 构造带控制方法的 fake Query(async generator + 控制方法)
function fakeQuery(over: Record<string, unknown> = {}) {
  const gen = (async function* () {
    /* 探针不产出消息 */
  })();
  return Object.assign(gen, {
    reloadPlugins: async () => ({
      plugins: [{ name: "packyapi", path: "/abs/plugins/packyapi", source: "local" }],
      mcpServers: [],
      agents: [],
      commands: [],
      error_count: 0,
    }),
    reloadSkills: async () => ({
      skills: [{ name: "packyapi", description: "查价", argumentHint: "" }],
    }),
    mcpServerStatus: async () => [
      {
        name: "cs",
        status: "connected",
        serverInfo: { name: "cs", version: "1.0.0" },
        tools: [{ name: "kb_search", description: "检索知识库", annotations: { readOnly: true } }],
      },
    ],
    interrupt: async () => {},
    ...over,
  });
}

function opts(over: Partial<ProbeOptions> = {}): ProbeOptions {
  const captured: { options?: any } = {};
  return {
    queryFn: ((params: any) => {
      captured.options = params.options;
      (opts as any)._captured = captured;
      return fakeQuery();
    }) as any,
    refresh: true,
    now: () => 1000,
    ...over,
  };
}

describe("probeCapabilities", () => {
  it("归一化 plugins/skills/mcp + 叠加门控", async () => {
    const caps = await probeCapabilities(cfg, opts());
    expect(caps.plugins[0]).toMatchObject({ name: "packyapi", path: "/abs/plugins/packyapi", source: "local" });
    expect(caps.skills[0]).toMatchObject({ name: "packyapi", description: "查价" });
    expect(caps.mcpServers[0]).toMatchObject({ name: "cs", status: "connected", version: "1.0.0" });
    expect(caps.mcpServers[0].tools[0]).toMatchObject({ name: "kb_search", readOnly: true });
    expect(caps.toolPolicy.allowlist[0]).toContain("Skill"); // 规则条含 TOOL_ALLOWLIST 内容
    expect(caps.probedAt).toBe(1000);
  });

  it("探针结束后 abort 被触发", async () => {
    await probeCapabilities(cfg, opts());
    const captured = (opts as any)._captured;
    expect(captured.options.abortController.signal.aborted).toBe(true);
  });

  it("单控制方法 rejected → 该区空,其余保留", async () => {
    const caps = await probeCapabilities(
      cfg,
      opts({
        queryFn: (() => fakeQuery({ reloadSkills: async () => { throw new Error("boom"); } })) as any,
      })
    );
    expect(caps.skills).toEqual([]);
    expect(caps.plugins.length).toBe(1);
  });
});

describe("probeCapabilities MCP 动态发现", () => {
  it("cs 由 mcpServerStatus 动态上报(不再静态补入),含 kb_search(只读)", async () => {
    const caps = await probeCapabilities(cfg, {
      queryFn: (() => fakeQuery()) as any, // fakeQuery 默认 mcpServerStatus 报 cs
      refresh: true,
      now: () => 2000,
    });
    const cs = caps.mcpServers.find((m) => m.name === "cs");
    expect(cs).toBeTruthy();
    expect(cs!.tools.find((t) => t.name === "kb_search")!.readOnly).toBe(true);
    expect(caps.mcpServers.filter((m) => m.name === "cs").length).toBe(1);
  });

  it("SDK 未报任何 MCP → mcpServers 为空(无静态补入)", async () => {
    const caps = await probeCapabilities(cfg, {
      queryFn: (() => fakeQuery({ mcpServerStatus: async () => [] })) as any,
      refresh: true,
      now: () => 2000,
    });
    expect(caps.mcpServers).toEqual([]);
  });
});

describe("probeCapabilities 缓存", () => {
  it("TTL 内二次调用不重启 query;refresh=true 绕过;TTL 过期重探", async () => {
    let calls = 0;
    let t = 1000;
    const mk = (refresh: boolean): ProbeOptions => ({
      queryFn: (() => { calls++; return fakeQuery(); }) as any,
      refresh,
      now: () => t,
    });
    await probeCapabilities(cfg, mk(true)); // seed cache at t=1000 (bypass any prior)
    calls = 0;                               // reset counter after seeding
    await probeCapabilities(cfg, mk(false)); // TTL 内命中缓存 → 不新增
    expect(calls).toBe(0);
    await probeCapabilities(cfg, mk(true)); // refresh 绕过 → +1
    expect(calls).toBe(1);
    t += 61_000; // 超 TTL
    await probeCapabilities(cfg, mk(false)); // 过期重探 → +1
    expect(calls).toBe(2);
  });
});

describe("probeCapabilities 零 token", () => {
  it("探针用流式空输入(async iterable),不发字符串 prompt —— 防误触发模型回合", async () => {
    let capturedPrompt: unknown;
    await probeCapabilities(cfg, {
      queryFn: ((params: any) => { capturedPrompt = params.prompt; return fakeQuery(); }) as any,
      refresh: true,
      now: () => 1,
    });
    expect(typeof capturedPrompt).not.toBe("string");
    expect(typeof (capturedPrompt as any)?.[Symbol.asyncIterator]).toBe("function");
  });
});
