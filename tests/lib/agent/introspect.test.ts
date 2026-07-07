import { describe, it, expect } from "vitest";
import { buildToolPolicy } from "@/lib/agent/introspect";

describe("buildToolPolicy", () => {
  it("allowlist 含 kb_search / WebSearch / Skill,gated 含 Bash/Read/WebFetch", () => {
    const p = buildToolPolicy();
    expect(p.allowlist).toContain("mcp__cs__kb_search");
    expect(p.allowlist).toContain("WebSearch");
    expect(p.allowlist).toContain("Skill");
    const tools = p.gated.map((g) => g.tool);
    expect(tools).toEqual(["Bash", "Read", "WebFetch"]);
    for (const g of p.gated) expect(g.constraint.length).toBeGreaterThan(0);
  });
});

import { probeCapabilities, type ProbeOptions } from "@/lib/agent/introspect";
import type { AppConfig } from "@/lib/config-store";

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "",
  botQQ: 1,
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
    makeToolServer: () => ({}),
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
    expect(caps.toolPolicy.allowlist).toContain("Skill");
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
