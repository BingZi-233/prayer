import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { usageStats } from "../model/stats/usage"
import { toolStats, KB_PREFETCH_TOOL, KB_GROUNDED_TOOL } from "../model/stats/tool"
import { logger } from "../core/logger"
import type { ChannelId } from "../core/chat/types"
import type { BrandProfile } from "../core/brand"
import type { KbPrefetch } from "./kb-prefetch"
import { agentQueryOptions } from "../model/query-options"
import { buildPrompt, kbProbeText, type AgentMedia } from "../model/prompt"
import { usageFromResult } from "../model/drain"
import { buildDefaultSystem, DEFAULT_SYSTEM } from "../model/system-prompt"
import { isToolAllowed, denyMessage, CS_KB_TOOL } from "../model/tool-policy"

// 当前消息的会话上下文(orchestrator/poller 绑定,透传给 run;工具改由 cs 插件承载后当前未使用,保留签名)
export interface ToolContext {
  sessionKey: string
  /** 通道;主链路已传,旁路迁完前可选 */
  channel?: string
  /** 会话 id(字符串);主链路用此字段 */
  chatId?: string
  userId: string | number
  /** @deprecated 用 chatId;未迁完的旁路仍传 number */
  groupId?: number
}

export interface AgentDeps {
  // 模型不在此传:由 CLAUDE_CONFIG_DIR/settings.json 的 env.ANTHROPIC_MODEL 决定(见 run 内注释)
  systemPrompt: string
  /** 客服对外品牌；未传时使用 Prayer 默认身份。 */
  brand?: BrandProfile
  /** 办不了事务时引导的支持链接,注入 system prompt */
  supportUrl?: string
  // 本仓库 local plugin 目录绝对路径。通常不传:插件统一由
  // CLAUDE_CONFIG_DIR/settings.json 的 enabledPlugins(settingSources:["user"])加载,含其 MCP server。
  // 若显式传,则本地加载并开启 MCP 发现(与 enabledPlugins 二选一,避免双加载)。
  pluginPaths?: string[]
  /**
   * 知识库预检索:每轮消息进模型前自动检索并把片段注入 user prompt。
   * 不传 = 不预检索,prompt 与旧版逐字一致,退回纯 kb_search 工具路径。
   */
  kbPrefetch?: KbPrefetch
  queryFn?: typeof sdkQuery
  /**
   * 单次 run 的 wall-clock 超时(ms):SDK query 迭代(真实 = MiniMax relay 流)无自带超时,
   * relay 卡住则 for-await 永不结束 → handle promise 永挂 → 编排串行链永久卡死该会话所有后续 @。
   * 超时则 abort 子进程 + 降级(保留已累积文本,否则兜底文案)。默认 180s;<=0 关闭。
   */
  timeoutMs?: number
}

// run 默认超时:留足 maxTurns=20 + 工具往返;超过基本是 relay 挂死而非慢
export const DEFAULT_RUN_TIMEOUT_MS = 180_000

export interface AgentResult {
  text: string
  sessionId?: string
}

// Agent 降级兜底文案:maxTurns/CLI 出错且无累积文本时返回。主动路径据此判为非答案 → 沉默。
export const AGENT_FALLBACK_TEXT =
  "(处理超出步数上限或出错,请换个说法或稍后再试)"

export class Agent {
  private queryFn: typeof sdkQuery
  private timeoutMs: number
  constructor(private deps: AgentDeps) {
    this.queryFn = deps.queryFn ?? sdkQuery
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
  }

  private resolvedSystem(): string {
    if (this.deps.systemPrompt) return this.deps.systemPrompt
    if (this.deps.supportUrl || this.deps.brand) {
      return buildDefaultSystem({
        supportUrl: this.deps.supportUrl,
        brand: this.deps.brand,
      })
    }
    return DEFAULT_SYSTEM
  }

  /**
   * 预检索本轮知识库片段。fresh 取 !resumeId:去重的前提是「片段还在模型 context 里」,
   * 只有 resume 续聊才成立;新开会话(含 TTL 过期、哨兵清 resume、主动补位)必须重新注入。
   * 工厂内已 fail-open,这里再包一层双保险 —— 预检索绝不能阻断 run。
   */
  private async prefetchKb(
    text: string,
    resumeId: string | undefined,
    ctx: ToolContext,
    media?: AgentMedia
  ): Promise<string> {
    if (!this.deps.kbPrefetch || !ctx?.sessionKey) return ""
    try {
      return await this.deps.kbPrefetch(
        kbProbeText(text, media),
        ctx.sessionKey,
        { fresh: !resumeId }
      )
    } catch (e) {
      console.warn("[agent] 预检索异常,跳过注入:", e)
      return ""
    }
  }

  async run(
    text: string,
    resumeId: string | undefined,
    ctx: ToolContext,
    media?: AgentMedia
  ): Promise<AgentResult> {
    const kbBlock = await this.prefetchKb(text, resumeId, ctx, media)
    // 本 run 的工具调用计数(工具名 → 次数),在 finally 一次性提交给 toolStats
    const toolCalls = new Map<string, number>()
    let sessionId: string | undefined = resumeId
    let out = ""
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // 超时到点 abort:让 SDK reject 迭代器并杀掉 CLI 子进程(best-effort);
      // 即便子进程忽略 abort,下方 Promise.race 也会靠计时器兜底返回,run 不会卡死。
      // queryFn 同步抛错(SDK options 校验 / spawn 立即失败)也纳入 try:
      // 否则 run 整体 reject 不走降级,用户对该消息收到纯沉默。
      const abortController = new AbortController()
      const iter = this.queryFn({
        prompt: buildPrompt(text, media, kbBlock),
        options: agentQueryOptions({
          abortController,
          // 模型由 CLAUDE_CONFIG_DIR 内配置决定,不在此覆盖
          // 用完整自定义 system prompt(不套 claude_code preset):preset 的编码助手人格会
          // 干扰视觉输入(实测带图时模型回"无图"),且本就需靠 prompt 抹掉编码设定 —— 直接替换更干净。
          // system prompt 恒定(无按调用方拼接的后缀)—— 主动/正常两条路径共享同一前缀,
          // TTL 内可跨路径命中缓存;主动模式的行为指令改由 unanswered-poller 并入 user prompt。
          systemPrompt: this.resolvedSystem(),
          // 业务插件及其 MCP server 由 enabledPlugins(settingSources:["user"])加载,不在此显式装配。
          // 仅当显式传 pluginPaths 时本地加载并开启 MCP 发现(默认发现,不设 skipMcpDiscovery)。
          plugins: (this.deps.pluginPaths ?? []).map((p) => ({
            type: "local" as const,
            path: p,
          })),
          // 单一放行出口:不用 allowedTools 预授权(bare 名会 shadow canUseTool),全部工具落到此回调
          // 白名单判定见 isToolAllowed;未命中一律拒绝(headless 不弹交互授权)
          canUseTool: async (
            toolName: string,
            input: Record<string, unknown>
          ) => {
            if (isToolAllowed(toolName, input)) {
              return { behavior: "allow" as const, updatedInput: input }
            }
            // 精准拒因 message:笼统的"未授权"会让模型误以为是语法问题、换参数重试,
            // 白烧 turn 直到 maxTurns。明确"停手 + 改走 kb_search/技能"堵掉 deny 循环。
            const message = denyMessage(toolName)
            // 走结构化 logger(带 scope/会话定位):裸 console 会把群友可控的
            // tool input 原样投进 ring buffer,且无定位元数据;截断防刷屏
            logger.warn(`[agent] 拒绝工具调用: ${toolName}`, {
              scope: "agent.deny",
              channel: ctx.channel as ChannelId | undefined,
              chatId: ctx.chatId,
              sessionKey: ctx.sessionKey,
              raw: JSON.stringify(input).slice(0, 120),
            })
            return { behavior: "deny" as const, message }
          },
          resume: resumeId,
          maxTurns: 20,
          // 强制 default:CLAUDE_CONFIG_DIR/settings.json 里若合了 bypassPermissions,
          // 会整体跳过 canUseTool,让上面的白名单形同虚设 —— 显式钉死模式堵死这个绕过口子
          // (permissionMode / env / settingSources / tools / skills 已由 agentQueryOptions 钉好)
          // agentQueryOptions 返回宽松 Record(供多处覆盖合并),此处收拢为 SDK Options
        }) as Options,
      })

      // 迭代累积独立成 promise,供 Promise.race 与超时计时器竞速。
      // out / sessionId 由闭包写入,超时胜出时仍能返回已累积内容。
      const drain = (async () => {
        for await (const msg of iter) {
          if (
            msg.type === "system" &&
            msg.subtype === "init" &&
            msg.session_id
          ) {
            sessionId = msg.session_id
          }
          if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
            for (const block of msg.message.content) {
              if (block.type === "text") out += block.text
              // 工具用量观测:block 是 SDK 的 union,取 name 需窄化(同 pickStructuredFromMessage 的写法)
              else if (block.type === "tool_use") {
                const name = String((block as { name?: unknown }).name ?? "")
                if (name) toolCalls.set(name, (toolCalls.get(name) ?? 0) + 1)
              }
            }
          }
          // 末尾 result:记账缓存/用量。内联(不走 drainQuery)以保留下方降级逻辑
          const usage = usageFromResult(msg)
          if (usage) usageStats.record("agent", usage)
        }
      })()
      // 超时胜出后 drain 常因 abort 迟到 reject:挂一个吞噬 handler 防 unhandledRejection
      // (race 仍会各自收到该 reject,不影响下方降级)
      drain.catch(() => {})

      if (this.timeoutMs > 0) {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abortController.abort()
            reject(new Error(`agent run 超时(${this.timeoutMs}ms)`))
          }, this.timeoutMs)
        })
        await Promise.race([drain, timeout])
      } else {
        await drain
      }
    } catch (e) {
      // maxTurns / CLI 异常(SDK reject 迭代器)、超时或 queryFn 同步抛错:降级 ——
      // 保留已累积文本与 sessionId,避免整个请求 500、丢掉会话,更避免 handle 永挂拖死编排串行链
      console.error("[agent] query 启动/迭代中断/超时,降级返回已累积内容:", e)
      if (!out.trim()) out = AGENT_FALLBACK_TEXT
    } finally {
      if (timer) clearTimeout(timer)
      // 超时/异常降级的 run 也要计入,否则覆盖率分母失真
      if (kbBlock) toolCalls.set(KB_PREFETCH_TOOL, 1)
      if (kbBlock || toolCalls.has(CS_KB_TOOL))
        toolCalls.set(KB_GROUNDED_TOOL, 1)
      toolStats.recordRun("agent", Object.fromEntries(toolCalls))
    }
    return { text: out.trim(), sessionId }
  }
}
