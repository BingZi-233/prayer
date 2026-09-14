import { resolve } from "path"
import { bus, emitErrorSafely } from "./core/bus"
import { logger } from "./core/logger"
import type { AppConfig } from "./core/config-store"
import type { Repo } from "./core/db/repo"
import type { Agent } from "./conversation/agent"
import type { AssembleDeps } from "./conversation/assemble"
import { bindUsagePersistence } from "./model/stats/usage"
import { bindToolStatsPersistence } from "./model/stats/tool"
import type { Channel, ChannelId, ChannelStatus } from "./core/chat/types"
import { ChannelRegistry } from "./channels/registry"
import { createChannels } from "./channels/factory"
import { resolveRuntimeChatConfig } from "./core/chat/enabled-chats"
import { resolveBrand } from "./core/brand"
import { redactSensitive } from "./core/log-context"
import { canonicalDbPath } from "./core/db/path"

export type RuntimeState =
  "stopped" | "starting" | "running" | "degraded" | "error"

export interface RuntimeStatus {
  state: RuntimeState
  /** 运行管线已装配且所有必要通道当前可用。 */
  ready: boolean
  /** 兼容字段:qq 通道是否已连接 */
  wsConnected: boolean
  sessionCount: number
  handoffQueue: number
  lastError?: string
  bootedAt?: number
  channels?: ChannelStatus[]
}

export interface RuntimeReadiness {
  ready: boolean
  state: RuntimeState
  /** 由凭据、启用会话、管理面和实际注册通道汇总出的必要通道。 */
  requiredChannels: ChannelId[]
  /** 尚未启动、未连接或带错误的必要通道。 */
  unavailableChannels: ChannelStatus[]
  channels: ChannelStatus[]
  lastError?: string
}

/**
 * 状态接口给管理 API 共用：只有明确的启动错误才算本次应用失败。
 * 通道刚启动、尚在建立长连接时会短暂 degraded 但没有 lastError，不能把
 * 这种异步连接窗口误报成配置写入失败；/health/ready 会继续返回 503。
 */
export function runtimeFailureMessage(
  status: Pick<RuntimeStatus, "state" | "lastError">
): string | undefined {
  if (status.state === "error") return status.lastError ?? "运行时启动失败"
  if (status.state === "degraded" && status.lastError) return status.lastError
  return undefined
}

// 管理 API 的配置、插件和重启操作共用一条进程内队列。放到 globalThis，
// 让 Next 的分路由 server bundle 也不会各自持有一把锁；RuntimeManager
// 另外保留实例级生命周期队列，覆盖非 HTTP 调用者。
const mutationState = (() => {
  const root = globalThis as typeof globalThis & {
    __prayerRuntimeMutation?: { queue: Promise<void> }
  }
  return (root.__prayerRuntimeMutation ??= { queue: Promise.resolve() })
})()
export function serializeRuntimeMutation<T>(fn: () => Promise<T>): Promise<T> {
  const previous = mutationState.queue
  let release!: () => void
  mutationState.queue = new Promise<void>((resolve) => {
    release = resolve
  })
  return previous
    .catch(() => undefined)
    .then(fn)
    .finally(() => release())
}

export interface RuntimeBuilders {
  openDb: (path: string) => unknown
  makeRepo: (db: unknown) => Repo
  makeAgent: (cfg: AppConfig, repo: Repo) => Agent
  assemble: (args: AssembleDeps) => () => void
  /**
   * 测试注入：覆盖默认 QQ 工厂。
   * url 为空时 factory 不调用本函数。生产路径可不传（用 createChannels 默认表）。
   */
  makeQqChannel?: (
    url: string,
    token: string | undefined,
    onStatus: (c: boolean) => void
  ) => Channel
  /**
   * 测试注入：覆盖默认 TG 工厂。
   * token 为空时 factory 不调用本函数。
   */
  makeTgChannel?: (
    token: string,
    repo: Repo,
    onStatus?: (c: boolean) => void
  ) => Channel
}

async function defaultBuilders(): Promise<RuntimeBuilders> {
  const { sharedDb } = await import("./core/db/shared")
  const { Repo } = await import("./core/db/repo")
  const { Agent } = await import("./conversation/agent")
  const { makeKbPrefetch } = await import("./knowledge/kb-prefetch")
  // 本地嵌入模型是 native 依赖,只在 Node runtime 动态加载,别提到模块顶层
  const { embed } = await import("./model/embed")
  const { assemble } = await import("./conversation/assemble")
  return {
    // 复用 API 路由的进程级共享连接:reconfigure 不关它,in-flight 的
    // 异步 scanOnce(await agent.run 期间)不会撞到 "database connection is not open"
    openDb: (p) => sharedDb(p),
    makeRepo: (db) => new Repo(db as never),
    makeAgent: (cfg, repo) =>
      new Agent({
        // 支持链接注入 system prompt,办不了事务时引导
        systemPrompt: "",
        brand: resolveBrand({
          name: cfg.brandName,
          description: cfg.brandDescription,
        }),
        supportUrl: cfg.supportUrl,
        // 预检索注入:每轮先给候选片段,避免 resume 长会话凭记忆跳过检索
        // (实测覆盖率曾掉到 11%~70%)。候选不是最终依据,易变业务数据仍须调对应工具;
        // 关掉则退回纯知识库 / 业务工具路径。
        kbPrefetch: cfg.kbPrefetchEnabled
          ? makeKbPrefetch({
              repo,
              embed,
              topK: cfg.kbPrefetchTopK,
              maxDistance: cfg.kbPrefetchMaxDistance,
              // 去重记忆与会话续接窗口对齐:超窗后会开新对话,片段不再在 context 里
              memoTtlMs: cfg.resumeTtlMs,
            })
          : undefined,
        // 不显式传 pluginPaths:业务插件及其 MCP server 唯一由 CLAUDE_CONFIG_DIR/settings.json
        // 的 enabledPlugins(settingSources:["user"])加载,避免与显式 plugins 双加载/冲突。
        // web 插件管理器通过 claude plugin CLI 管理 enabledPlugins + cache。
        // 知识库检索由 cs 插件的 MCP server 承载,其子进程经 env DB_PATH(见 start)打开 DB。
      }),
    assemble,
    // 通道构造走 createChannels 默认工厂表；测试通过 makeQqChannel/makeTgChannel 覆盖
  }
}

export class RuntimeManager {
  private state: RuntimeState = "stopped"
  private lastError?: string
  private bootedAt?: number
  private repo?: Repo
  private registry?: ChannelRegistry
  private requiredChannels: ChannelId[] = []
  // 启动失败后保留一份不含凭据的拓扑快照；teardown 会卸载 registry，但
  // /health/ready 与管理页仍需知道是哪条必要通道导致 not ready。
  private failureChannels: ChannelStatus[] = []
  private failureRequiredChannels: ChannelId[] = []
  private teardown?: () => void
  private unbindUsage?: () => void
  private unbindToolStats?: () => void
  private wsConnected = false
  // 每个 manager 仍保留实例级队列，保护测试/多实例调用者；管理 API 另用
  // serializeRuntimeMutation 包住配置和插件文件 mutation 的完整事务。
  private lifecycle: Promise<void> = Promise.resolve()

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.lifecycle
    let release!: () => void
    this.lifecycle = new Promise<void>((resolve) => {
      release = resolve
    })
    return previous
      .catch(() => undefined)
      .then(fn)
      .finally(() => release())
  }

  getStatus(): RuntimeStatus {
    const channels = this.registry?.status() ?? this.failureChannels
    const ready = this.isReady(channels)
    return {
      state: this.effectiveState(ready),
      ready,
      wsConnected: this.wsConnected,
      sessionCount: this.repo ? this.repo.countSessions() : 0,
      handoffQueue: this.repo ? this.repo.countHumanSessions() : 0,
      lastError: this.safeDiagnostic(this.lastError),
      bootedAt: this.bootedAt,
      channels:
        this.registry || this.failureChannels.length > 0
          ? channels.map((channel) => this.safeChannelStatus(channel))
          : undefined,
    }
  }

  getReadiness(): RuntimeReadiness {
    const channels = this.registry?.status() ?? this.failureChannels
    const required =
      this.requiredChannels.length > 0
        ? this.requiredChannels
        : this.failureRequiredChannels
    const byId = new Map(channels.map((channel) => [channel.id, channel]))
    const unavailableChannels = required
      .map(
        (id) =>
          byId.get(id) ?? {
            id,
            connected: false,
            lastError:
              "channel not registered (missing credentials or adapter)",
          }
      )
      .filter((channel) => !channel.connected || !!channel.lastError)
    return {
      ready: this.isReady(channels),
      state: this.effectiveState(this.isReady(channels)),
      requiredChannels: [...required],
      unavailableChannels: unavailableChannels.map((channel) =>
        this.safeChannelStatus(channel)
      ),
      channels: channels.map((channel) => this.safeChannelStatus(channel)),
      lastError: this.safeDiagnostic(this.lastError),
    }
  }

  getChannel(id: ChannelId): Channel | undefined {
    return this.registry?.get(id)
  }

  async getGroups(): Promise<unknown[] | undefined> {
    const chats = await this.registry?.get("qq")?.listChats?.()
    if (!chats) return undefined
    // 保持 OneBot 原始形态,兼容 /api/onebot/groups 的 parseGroups
    return chats.map((c) => ({
      group_id: Number(c.id),
      group_name: c.name,
    }))
  }

  async getGroupMembers(groupId: number): Promise<unknown[] | undefined> {
    return this.registry?.get("qq")?.listMembers?.(String(groupId))
  }

  async start(cfg: AppConfig, builders: RuntimeBuilders): Promise<void> {
    return this.serialize(() => this.startUnlocked(cfg, builders))
  }

  private async startUnlocked(
    cfg: AppConfig,
    builders: RuntimeBuilders
  ): Promise<void> {
    if (this.state !== "stopped") await this.stopUnlocked()
    this.state = "starting"
    this.lastError = undefined
    this.failureChannels = []
    this.failureRequiredChannels = []
    try {
      // 绝对化:CLI 子进程可能以不同 cwd 解析相对路径,绝对路径确保稳定命中配置目录
      process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir)
      // DB_PATH 供 cs 插件 MCP 子进程(plugins/cs/scripts/cs-mcp.ts)继承打开知识库(只读)
      process.env.DB_PATH = canonicalDbPath(cfg.dbPath)
      const db = builders.openDb(cfg.dbPath)
      const repo = builders.makeRepo(db)
      const agent = builders.makeAgent(cfg, repo)
      const { enabledChats, adminSurface } = resolveRuntimeChatConfig(cfg)
      const requiredChannels = new Set<ChannelId>(
        enabledChats.map((chat) => chat.channel)
      )
      if (adminSurface) requiredChannels.add(adminSurface.channel)
      if (cfg.onebotWsUrl?.trim()) requiredChannels.add("qq")
      if (cfg.telegramBotToken?.trim()) requiredChannels.add("tg")
      this.requiredChannels = [...requiredChannels]

      this.unbindUsage = bindUsagePersistence(repo, {
        budgetUsd: cfg.usageBudgetUsd,
        onBudgetExceeded: (day, cost) => {
          if (adminSurface) {
            bus.emit("action.send", {
              channel: adminSurface.channel,
              chatId: adminSurface.chatId,
              text: `【用量告警】${day} 累计约 $${cost.toFixed(4)},已超过预算 $${cfg.usageBudgetUsd}`,
            })
          }
        },
      })
      this.unbindToolStats = bindToolStatsPersistence(repo)

      // 空 registry 先挂上：assemble 闭包引用 isBypassEnabled；
      // register 在 assemble 之后同步完成，poller 首轮 tick 前通道已就绪。
      const registry = new ChannelRegistry({ outbox: repo.outbox })
      this.registry = registry

      this.teardown = builders.assemble({
        repo,
        botQQ: cfg.botQQ,
        extraAtQQs: cfg.extraAtQQs,
        enabledChats,
        adminSurface,
        isBypassEnabled: (channel, chatId) =>
          registry.isBypassEnabled(channel, chatId),
        agent,
        reflectScanMs: cfg.reflectScanMs,
        reflectLookbackMs: cfg.reflectLookbackMs,
        reflectSettleMs: cfg.reflectSettleMs,
        reflectWindowMax: cfg.reflectWindowMax,
        reflectCompactMs: cfg.reflectCompactMs,
        reflectCompactMinEntries: cfg.reflectCompactMinEntries,
        reflectPromoteMs: cfg.reflectPromoteMs,
        reflectPromoteMinEntries: cfg.reflectPromoteMinEntries,
        reflectPromoteMaxPerRun: cfg.reflectPromoteMaxPerRun,
        reflectNotifyAdmin: cfg.reflectNotifyAdmin,
        resumeTtlMs: cfg.resumeTtlMs,
        proactiveEnabled: cfg.proactiveEnabled,
        proactiveScanMs: cfg.proactiveScanMs,
        proactiveSilenceMs: cfg.proactiveSilenceMs,
        proactiveMaxPerScan: cfg.proactiveMaxPerScan,
        proactiveCandidateBudget: cfg.proactiveCandidateBudget,
        handoffTimeoutMin: cfg.handoffTimeoutMin,
        brand: resolveBrand({
          name: cfg.brandName,
          description: cfg.brandDescription,
        }),
        supportUrl: cfg.supportUrl,
        ackEnabled: cfg.ackEnabled,
        maxReplyChars: cfg.maxReplyChars,
        topicScanMs: cfg.topicScanMs,
        topicSettleMs: cfg.topicSettleMs,
        topicWindowMax: cfg.topicWindowMax,
        topicPromptMax: cfg.topicPromptMax,
        groupPolicies: cfg.groupPolicies,
      })

      // 表驱动注册：默认工厂 + 测试 overrides
      const channels = createChannels({
        cfg,
        repo,
        onStatus: {
          qq: (c) => {
            this.wsConnected = c
          },
        },
        overrides: {
          ...(builders.makeQqChannel
            ? {
                qq: (ctx) => {
                  const url = ctx.cfg.onebotWsUrl?.trim()
                  if (!url) return null
                  return builders.makeQqChannel!(
                    url,
                    ctx.cfg.onebotAccessToken || undefined,
                    ctx.onStatus?.qq ?? (() => {})
                  )
                },
              }
            : {}),
          ...(builders.makeTgChannel
            ? {
                tg: (ctx) => {
                  const token = ctx.cfg.telegramBotToken?.trim()
                  if (!token) return null
                  return builders.makeTgChannel!(
                    token,
                    ctx.repo,
                    ctx.onStatus?.tg
                  )
                },
              }
            : {}),
        },
      })
      for (const ch of channels) {
        registry.register(ch)
        requiredChannels.add(ch.id)
      }
      this.requiredChannels = [...requiredChannels]

      const registered = new Set(channels.map((channel) => channel.id))
      const missing = [...requiredChannels].filter((id) => !registered.has(id))

      const startResults = await registry.startAll()

      this.repo = repo
      this.bootedAt = Date.now()
      const failures = startResults
        .map((result, index) =>
          result.status === "rejected"
            ? { id: channels[index]!.id, reason: result.reason }
            : undefined
        )
        .filter(
          (failure): failure is { id: ChannelId; reason: unknown } =>
            failure !== undefined
        )
      const unavailable = [
        ...missing.map((id) => ({
          id,
          message: `${id}: channel not registered (missing credentials or adapter)`,
        })),
        ...failures.map(({ id, reason }) => ({
          id,
          message: `${id}: ${
            reason instanceof Error ? reason.message : String(reason)
          }`,
        })),
      ]
      if (unavailable.length > 0) {
        this.lastError = unavailable.map(({ message }) => message).join("; ")
        this.state = "degraded"
        logger.log("warn", `[runtime] started degraded: ${this.lastError}`)
      } else {
        this.state = "running"
        logger.log("info", "[runtime] started")
      }
    } catch (err) {
      this.failureRequiredChannels = [...this.requiredChannels]
      try {
        this.failureChannels = this.registry?.status() ?? []
      } catch {
        this.failureChannels = []
      }
      // 先发布错误，再拆卸 assemble 的订阅；否则 resolution-recorder 等
      // 统一观测器会随 teardown 一起解绑，启动失败就从指标中消失。
      emitErrorSafely({
        scope: "runtime.start",
        err,
        userVisible: false,
      })
      // 回收可能已半装配的资源(定时器/监听器/DB 连接),避免失败 start 泄漏
      await this.teardownAll()
      this.state = "error"
      this.lastError = err instanceof Error ? err.message : String(err)
      logger.log("error", `[runtime] start failed: ${this.lastError}`)
    }
  }

  /** 卸载管线拥有的所有资源:teardown(监听器+定时器)、通道 registry。
   *  DB 连接由 sharedDb 进程级缓存持有,不在此关闭:否则会切断 API 路由
   *  与仍在 await agent.run 的 in-flight scanOnce,触发 "database connection is not open"。 */
  private async teardownAll(): Promise<void> {
    try {
      this.unbindUsage?.()
    } catch {
      /* ignore */
    }
    try {
      this.unbindToolStats?.()
    } catch {
      /* ignore */
    }
    try {
      this.teardown?.()
    } catch (e) {
      logger.log(
        "warn",
        `[runtime] teardown error: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    try {
      await this.registry?.stopAll()
    } catch {
      /* ignore */
    }
    // 兜底诊断:正常路径应已由 assemble disposer + channel.stop 卸掉监听器。
    // 不调用 bus.removeAllListeners()：总线是进程级 singleton，强制清空会
    // 误删插件/测试/其它应用组件的监听器；泄漏只记录，交给后续修复。
    const leftover = bus
      .eventNames()
      .reduce((n, name) => n + bus.listenerCount(name), 0)
    if (leftover > 0) {
      logger.log(
        "warn",
        `[runtime] ${leftover} bus listener(s) remain after dispose; external listeners preserved`
      )
    }
    this.teardown = undefined
    this.unbindUsage = undefined
    this.unbindToolStats = undefined
    this.registry = undefined
    this.requiredChannels = []
    this.repo = undefined
    this.wsConnected = false
  }

  private async stopUnlocked(): Promise<void> {
    await this.teardownAll()
    this.failureChannels = []
    this.failureRequiredChannels = []
    this.state = "stopped"
    logger.log("info", "[runtime] stopped")
  }

  async stop(): Promise<void> {
    return this.serialize(() => this.stopUnlocked())
  }

  async reconfigure(cfg: AppConfig, builders: RuntimeBuilders): Promise<void> {
    return this.serialize(async () => {
      await this.stopUnlocked()
      await this.startUnlocked(cfg, builders)
    })
  }

  private isReady(channels: ChannelStatus[]): boolean {
    if (this.state !== "running") return false
    const byId = new Map(channels.map((channel) => [channel.id, channel]))
    const required =
      this.requiredChannels.length > 0
        ? this.requiredChannels
        : this.failureRequiredChannels
    return required.every((id) => {
      const channel = byId.get(id)
      return !!channel && channel.connected && !channel.lastError
    })
  }

  /**
   * QQ/TG 的 start() 会先启动后台连接循环再返回，因此 Promise fulfilled
   * 只代表“启动已受理”，不代表通道已经可用。对外状态必须跟实时连接态走，
   * 否则 readiness 已经 503 时管理面仍会误报 running。
   */
  private effectiveState(ready: boolean): RuntimeState {
    return this.state === "running" && !ready ? "degraded" : this.state
  }

  private safeDiagnostic(value?: string): string | undefined {
    return value == null ? undefined : redactSensitive(value).slice(0, 500)
  }

  private safeChannelStatus(status: ChannelStatus): ChannelStatus {
    return {
      ...status,
      lastError: this.safeDiagnostic(status.lastError),
      detail: this.safeDiagnostic(status.detail),
    }
  }
}

const g = globalThis as unknown as { __runtimeMgr?: RuntimeManager }
export function getRuntime(): RuntimeManager {
  return g.__runtimeMgr ?? (g.__runtimeMgr = new RuntimeManager())
}

export { defaultBuilders }
