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
    allowlist: ["mcp__* — 所有插件 MCP 工具", ...TOOL_ALLOWLIST],
    gated: [
      { tool: "Bash", constraint: "整体禁用,不接受任何命令" },
      { tool: "Read", constraint: "整体禁用,不读任何文件" },
    ],
  };
}

export interface ProbeOptions {
  queryFn?: typeof sdkQuery;
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

// 轮询 mcpServerStatus 直到无 pending(所有 server 连上/失败)或超时。
// 插件 MCP 为子进程,握手需时(cs 要先加载 embed 模型数秒);不轮询则读到 pending / 空 tools。
// 全程不产出 user 消息 → 不触发模型 → 零 token。
async function pollMcpStatus(
  q: { mcpServerStatus: () => Promise<McpStatusRaw[]> },
  timeoutMs = 20_000,
  stepMs = 500
): Promise<McpStatusRaw[]> {
  const deadline = Date.now() + timeoutMs;
  let last: McpStatusRaw[] = [];
  for (;;) {
    last = await settled(q.mcpServerStatus(), [] as McpStatusRaw[]);
    if (last.length === 0 || last.every((s) => s.status !== "pending")) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const CACHE_TTL_MS = 60_000;
const capCacheHolder = globalThis as unknown as { __capCache?: { at: number; data: Capabilities } };

export async function probeCapabilities(cfg: AppConfig, opts: ProbeOptions = {}): Promise<Capabilities> {
  const now = opts.now ?? Date.now;
  if (!opts.refresh && capCacheHolder.__capCache && now() - capCacheHolder.__capCache.at < CACHE_TTL_MS) {
    return capCacheHolder.__capCache.data;
  }
  const data = await probeUncached(cfg, opts);
  capCacheHolder.__capCache = { at: now(), data };
  return data;
}

async function probeUncached(cfg: AppConfig, opts: ProbeOptions = {}): Promise<Capabilities> {
  const now = opts.now ?? Date.now;
  const queryFn = opts.queryFn ?? sdkQuery;

  // 绝对化配置目录与 DB 路径,防 cwd 漂移(与 runtime.start 一致)。
  // DB_PATH 供 cs 插件 MCP 子进程(plugins/cs/scripts/cs-mcp.ts)继承打开知识库。
  process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir);
  process.env.DB_PATH = resolve(cfg.dbPath);

  const abortController = new AbortController();

  const q = queryFn({
    // 流式空输入:永不产出 user 消息 —— CLI 仍完成 init(控制方法可用),但无 user turn →
    // 不派发模型调用 → 零 token(不依赖 abort 抢在模型请求之前的竞态)。待 abort 时结束输入流。
    prompt: (async function* () {
      await new Promise<void>((r) => {
        if (abortController.signal.aborted) return r();
        abortController.signal.addEventListener("abort", () => r(), { once: true });
      });
    })() as any,
    options: {
      // cs / packyapi 及其 MCP server 全部经 enabledPlugins(settingSources:["user"])动态加载并被
      // mcpServerStatus() 上报 —— 不再静态装配 in-process cs,也不显式传 pluginPaths。
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
      pollMcpStatus(q),
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
