import { resolve } from "path"
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { AppConfig } from "../config-store"
import { TOOL_ALLOWLIST, isToolAllowed, sdkEnv } from "./agent"

export interface CapabilityTool {
  name: string
  description?: string
  readOnly?: boolean
}
export interface CapabilityMcpServer {
  name: string
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled"
  version?: string
  error?: string
  scope?: string
  tools: CapabilityTool[]
}
export interface CapabilitySkill {
  name: string
  description: string
  argumentHint?: string
}
export interface CapabilityPlugin {
  name: string
  path: string
  source?: string
}
export interface CapabilityToolPolicy {
  allowlist: string[]
  gated: { tool: string; constraint: string }[]
}
export interface Capabilities {
  plugins: CapabilityPlugin[]
  skills: CapabilitySkill[]
  mcpServers: CapabilityMcpServer[]
  toolPolicy: CapabilityToolPolicy
  probedAt: number
}

// 工具门控:唯一真源是 agent.ts 的 isToolAllowed(允许制:mcp__ 前缀或命中 TOOL_ALLOWLIST 才放行)。
// 不再手写枚举被禁工具 —— 把 probe 到的 Agent 实际暴露工具(liveTools)逐个跑 isToolAllowed 分区:
//   放行的进 allowlist;被拒的进 gated,逐条列真实工具名。
// 内建宿主工具(Bash/Read/Web* 等)需模型 turn 才被 getContextUsage 上报,零 token probe 看不到,
// 故补一条规则兜底(不点名任何工具),说明「规则外一律 deny」,避免手写清单造成漂移/误读。
export function buildToolPolicy(
  liveTools: string[] = []
): CapabilityToolPolicy {
  const uniq = [...new Set(liveTools)]
  const allowRule = ["mcp__* 前缀工具", ...TOOL_ALLOWLIST].join("、")
  return {
    allowlist: [
      `规则:放行 ${allowRule}`,
      ...uniq.filter((t) => isToolAllowed(t, {})),
    ],
    gated: [
      ...uniq
        .filter((t) => !isToolAllowed(t, {}))
        .map((tool) => ({
          tool,
          constraint: "未命中放行规则 → canUseTool 拒绝(deny)",
        })),
      {
        tool: "其余一切工具(非 mcp__ 前缀且不在放行白名单)",
        constraint: "允许制:一律 canUseTool 拒绝(deny)",
      },
    ],
  }
}

export interface ProbeOptions {
  queryFn?: typeof sdkQuery
  refresh?: boolean
  now?: () => number
}

// getContextUsage 返回的子集(仅取工具清单三块;其余字段忽略)
type ContextUsageLite = {
  mcpTools?: { name: string }[]
  systemTools?: { name: string }[]
  deferredBuiltinTools?: { name: string }[]
}

type McpStatusRaw = {
  name: string
  status: CapabilityMcpServer["status"]
  serverInfo?: { name: string; version: string }
  error?: string
  scope?: string
  tools?: {
    name: string
    description?: string
    annotations?: { readOnly?: boolean }
  }[]
}

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
  }))
}

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch {
    return fallback
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
  const deadline = Date.now() + timeoutMs
  let last: McpStatusRaw[] = []
  for (;;) {
    last = await settled(q.mcpServerStatus(), [] as McpStatusRaw[])
    if (last.length === 0 || last.every((s) => s.status !== "pending"))
      return last
    if (Date.now() >= deadline) return last
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

const CACHE_TTL_MS = 60_000
const capCacheHolder = globalThis as unknown as {
  __capCache?: { at: number; data: Capabilities }
}

// probe 用到的控制面(Query 的结构子集):真实 SDK Query 与测试桩都收敛到这个形状,
// 只声明实际消费的方法与字段,不绑定 SDK 控制响应的全量类型
interface ProbeQuery extends AsyncIterable<SDKMessage> {
  reloadPlugins(): Promise<{ plugins?: CapabilityPlugin[] }>
  reloadSkills(): Promise<{ skills?: CapabilitySkill[] }>
  mcpServerStatus(): Promise<McpStatusRaw[]>
  getContextUsage?: () => Promise<ContextUsageLite>
}

export async function probeCapabilities(
  cfg: AppConfig,
  opts: ProbeOptions = {}
): Promise<Capabilities> {
  const now = opts.now ?? Date.now
  if (
    !opts.refresh &&
    capCacheHolder.__capCache &&
    now() - capCacheHolder.__capCache.at < CACHE_TTL_MS
  ) {
    return capCacheHolder.__capCache.data
  }
  const data = await probeUncached(cfg, opts)
  capCacheHolder.__capCache = { at: now(), data }
  return data
}

async function probeUncached(
  cfg: AppConfig,
  opts: ProbeOptions = {}
): Promise<Capabilities> {
  const now = opts.now ?? Date.now
  const queryFn = opts.queryFn ?? sdkQuery

  // 绝对化配置目录与 DB 路径,防 cwd 漂移(与 runtime.start 一致)。
  // DB_PATH 供 cs 插件 MCP 子进程(plugins/cs/scripts/cs-mcp.ts)继承打开知识库。
  process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir)
  process.env.DB_PATH = resolve(cfg.dbPath)

  const abortController = new AbortController()

  const q = queryFn({
    // 流式空输入:永不产出 user 消息 —— CLI 仍完成 init(控制方法可用),但无 user turn →
    // 不派发模型调用 → 零 token(不依赖 abort 抢在模型请求之前的竞态)。待 abort 时结束输入流。
    prompt: (async function* () {
      await new Promise<void>((r) => {
        if (abortController.signal.aborted) return r()
        abortController.signal.addEventListener("abort", () => r(), {
          once: true,
        })
      })
    })(),
    options: {
      // 业务插件及其 MCP server 全部经 enabledPlugins(settingSources:["user"])动态加载并被
      // mcpServerStatus() 上报 —— 不再静态装配 in-process cs,也不显式传 pluginPaths。
      settingSources: ["user"],
      permissionMode: "default",
      maxTurns: 1,
      abortController,
      env: sdkEnv(),
    },
  }) as unknown as ProbeQuery

  // 防御性 drain:确保 transport 被读取,控制响应能落地
  const drain = (async () => {
    try {
      for await (const _ of q) void _
    } catch {
      /* abort 会中断迭代,忽略 */
    }
  })()

  try {
    const [plugins, skills, mcp] = await Promise.all([
      settled(q.reloadPlugins(), { plugins: [] as CapabilityPlugin[] }),
      settled(q.reloadSkills(), { skills: [] as CapabilitySkill[] }),
      pollMcpStatus(q),
    ])
    // getContextUsage 在 MCP 连上后再取 —— mcpTools 要等 server 握手才上报;与 poll 并发会拿到空表。
    // systemTools/deferredBuiltinTools(内建宿主工具)需模型 turn 才上报,零 token probe 下仍多为空,
    // 由 buildToolPolicy 的规则兜底条覆盖。async thunk:老 SDK 无此方法时同步 throw 也转 reject 被 settled 兜住。
    const ctxUsage = await settled<ContextUsageLite>(
      (async () =>
        typeof q.getContextUsage === "function"
          ? await q.getContextUsage()
          : {})(),
      {}
    )
    const mcpServers = normalizeMcp(mcp)
    // liveTools 只取 getContextUsage(工具名是完全限定的 mcp__… / 内建裸名),逐个跑 isToolAllowed 分区。
    // 不用 mcpServerStatus().tools —— 那里是 server 内的裸工具名(如 kb_search),缺 mcp__ 前缀会被误判 gated。
    const liveTools = [
      ...(ctxUsage.mcpTools ?? []).map((t) => t.name),
      ...(ctxUsage.systemTools ?? []).map((t) => t.name),
      ...(ctxUsage.deferredBuiltinTools ?? []).map((t) => t.name),
    ]
    return {
      plugins: (plugins.plugins ?? []).map((p: CapabilityPlugin) => ({
        name: p.name,
        path: p.path,
        source: p.source,
      })),
      skills: (skills.skills ?? []).map((s: CapabilitySkill) => ({
        name: s.name,
        description: s.description,
        argumentHint: s.argumentHint || undefined,
      })),
      mcpServers,
      toolPolicy: buildToolPolicy(liveTools),
      probedAt: now(),
    }
  } finally {
    abortController.abort()
    await drain.catch(() => {})
  }
}
