import { resolve } from "path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AppConfig } from "../config-store";
import { TOOL_ALLOWLIST, sdkEnv } from "./agent";

export interface CapabilityTool {
  name: string;
  description?: string;
  readOnly?: boolean;
}
export interface CapabilityMcpServer {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  version?: string;
  error?: string;
  scope?: string;
  tools: CapabilityTool[];
}
export interface CapabilitySkill {
  name: string;
  description: string;
  argumentHint?: string;
}
export interface CapabilityPlugin {
  name: string;
  path: string;
  source?: string;
}
export interface CapabilityToolPolicy {
  allowlist: string[];
  gated: { tool: string; constraint: string }[];
}
export interface Capabilities {
  plugins: CapabilityPlugin[];
  skills: CapabilitySkill[];
  mcpServers: CapabilityMcpServer[];
  toolPolicy: CapabilityToolPolicy;
  probedAt: number;
}

// 静态工具门控:与 lib/agent/agent.ts 的 isToolAllowed/denyMessage 语义一致。
// SDK 不上报本 host 的白名单,故在此静态描述。
export function buildToolPolicy(): CapabilityToolPolicy {
  return {
    allowlist: [...TOOL_ALLOWLIST],
    gated: [
      { tool: "Bash", constraint: "仅放行 PackyAPI 查询脚本(node …/packy.ts),禁 shell 链接/重定向" },
      { tool: "Read", constraint: "仅读 packyapi 技能的 references/*.md" },
      { tool: "WebFetch", constraint: "仅访问 packyapi.com 及其子域" },
    ],
  };
}

// 与 lib/runtime.ts 默认 pluginPaths 保持一致
function defaultPluginPaths(): string[] {
  return [resolve(process.cwd(), "plugins/packyapi")];
}

export interface ProbeOptions {
  queryFn?: typeof sdkQuery;
  makeToolServer?: () => unknown;
  pluginPaths?: string[];
  refresh?: boolean;
  now?: () => number;
}

type McpStatusRaw = {
  name: string;
  status: CapabilityMcpServer["status"];
  serverInfo?: { name: string; version: string };
  error?: string;
  scope?: string;
  tools?: { name: string; description?: string; annotations?: { readOnly?: boolean } }[];
};

function normalizeMcp(list: McpStatusRaw[]): CapabilityMcpServer[] {
  return list.map((s) => ({
    name: s.name,
    status: s.status,
    version: s.serverInfo?.version,
    error: s.error,
    scope: s.scope,
    tools: (s.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      readOnly: t.annotations?.readOnly,
    })),
  }));
}

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function probeCapabilities(cfg: AppConfig, opts: ProbeOptions = {}): Promise<Capabilities> {
  const now = opts.now ?? Date.now;
  const queryFn = opts.queryFn ?? sdkQuery;
  const pluginPaths = opts.pluginPaths ?? defaultPluginPaths();

  // 绝对化配置目录,防 cwd 漂移(与 runtime.start 一致)
  process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir);

  const abortController = new AbortController();
  const toolServer = opts.makeToolServer ? opts.makeToolServer() : {};

  const q = queryFn({
    prompt: "probe",
    options: {
      mcpServers: { cs: toolServer as any },
      plugins: pluginPaths.map((p) => ({ type: "local" as const, path: p, skipMcpDiscovery: true })),
      settingSources: ["user"],
      permissionMode: "default",
      maxTurns: 1,
      abortController,
      env: sdkEnv(),
    } as any,
  }) as any;

  // 防御性 drain:确保 transport 被读取,控制响应能落地
  const drain = (async () => {
    try {
      for await (const _ of q as AsyncIterable<unknown>) void _;
    } catch {
      /* abort 会中断迭代,忽略 */
    }
  })();

  try {
    const [plugins, skills, mcp] = await Promise.all([
      settled(q.reloadPlugins(), { plugins: [] as CapabilityPlugin[] }),
      settled(q.reloadSkills(), { skills: [] as CapabilitySkill[] }),
      settled(q.mcpServerStatus() as Promise<McpStatusRaw[]>, [] as McpStatusRaw[]),
    ]);
    return {
      plugins: (plugins.plugins ?? []).map((p: CapabilityPlugin) => ({ name: p.name, path: p.path, source: p.source })),
      skills: (skills.skills ?? []).map((s: any) => ({
        name: s.name,
        description: s.description,
        argumentHint: s.argumentHint || undefined,
      })),
      mcpServers: normalizeMcp(mcp),
      toolPolicy: buildToolPolicy(),
      probedAt: now(),
    };
  } finally {
    abortController.abort();
    await drain.catch(() => {});
  }
}
