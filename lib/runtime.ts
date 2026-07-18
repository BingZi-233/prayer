import { resolve } from "path"
import { bus } from "./bus"
import { logger } from "./logger"
import type { AppConfig } from "./config-store"
import type { Repo } from "./db/repo"
import type { Agent } from "./agent/agent"
import type { AssembleDeps } from "./assemble"
import { bindUsagePersistence } from "./usage-stats"
import type { Channel, ChannelId, ChannelStatus } from "./channels/types"
import { ChannelRegistry } from "./channels/registry"
import { createChannels } from "./channels/factory"
import { resolveRuntimeChatConfig } from "./channels/enabled-chats"

export type RuntimeState = "stopped" | "starting" | "running" | "error"

export interface RuntimeStatus {
  state: RuntimeState
  /** 兼容字段:qq 通道是否已连接 */
  wsConnected: boolean
  sessionCount: number
  handoffQueue: number
  lastError?: string
  bootedAt?: number
  channels?: ChannelStatus[]
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
  const { sharedDb } = await import("./db/shared")
  const { Repo } = await import("./db/repo")
  const { Agent } = await import("./agent/agent")
  const { assemble } = await import("./assemble")
  return {
    // 复用 API 路由的进程级共享连接:reconfigure 不关它,in-flight 的
    // 异步 scanOnce(await agent.run 期间)不会撞到 "database connection is not open"
    openDb: (p) => sharedDb(p),
    makeRepo: (db) => new Repo(db as never),
    makeAgent: (cfg, _repo) =>
      new Agent({
        // 支持链接注入 system prompt,办不了事务时引导
        systemPrompt: "",
        supportUrl: cfg.supportUrl,
        // 不显式传 pluginPaths:插件(cs / packyapi)及其 MCP server 唯一由 CLAUDE_CONFIG_DIR/settings.json
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
  private teardown?: () => void
  private unbindUsage?: () => void
  private wsConnected = false
  private usageBudgetUsd = 0

  getStatus(): RuntimeStatus {
    return {
      state: this.state,
      wsConnected: this.wsConnected,
      sessionCount: this.repo ? this.repo.countSessions() : 0,
      handoffQueue: this.repo
        ? this.repo.listSessions().filter((s) => s.humanMode).length
        : 0,
      lastError: this.lastError,
      bootedAt: this.bootedAt,
      channels: this.registry?.status(),
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
    this.state = "starting"
    this.lastError = undefined
    try {
      // 绝对化:CLI 子进程可能以不同 cwd 解析相对路径,绝对路径确保稳定命中配置目录
      process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir)
      // DB_PATH 供 cs 插件 MCP 子进程(plugins/cs/scripts/cs-mcp.ts)继承打开知识库(只读)
      process.env.DB_PATH = resolve(cfg.dbPath)
      const db = builders.openDb(cfg.dbPath)
      const repo = builders.makeRepo(db)
      const agent = builders.makeAgent(cfg, repo)
      this.usageBudgetUsd = cfg.usageBudgetUsd

      const { enabledChats, adminSurface } = resolveRuntimeChatConfig(cfg)

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

      // 空 registry 先挂上：assemble 闭包引用 isBypassEnabled；
      // register 在 assemble 之后同步完成，poller 首轮 tick 前通道已就绪。
      const registry = new ChannelRegistry()
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
        handoffTimeoutMin: cfg.handoffTimeoutMin,
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
      }

      await registry.startAll()

      this.repo = repo
      this.bootedAt = Date.now()
      this.state = "running"
      logger.log("info", "[runtime] started")
    } catch (err) {
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
    // 兜底断言:正常路径应已由 assemble disposer + channel.stop 卸掉监听器
    const leftover = bus
      .eventNames()
      .reduce((n, name) => n + bus.listenerCount(name), 0)
    if (leftover > 0) {
      logger.log(
        "warn",
        `[runtime] ${leftover} bus listener(s) remain after dispose; force removeAllListeners`
      )
      bus.removeAllListeners()
    }
    this.teardown = undefined
    this.unbindUsage = undefined
    this.registry = undefined
    this.repo = undefined
    this.wsConnected = false
  }

  async stop(): Promise<void> {
    await this.teardownAll()
    this.state = "stopped"
    logger.log("info", "[runtime] stopped")
  }

  async reconfigure(cfg: AppConfig, builders: RuntimeBuilders): Promise<void> {
    await this.stop()
    await this.start(cfg, builders)
  }
}

const g = globalThis as unknown as { __runtimeMgr?: RuntimeManager }
export function getRuntime(): RuntimeManager {
  return g.__runtimeMgr ?? (g.__runtimeMgr = new RuntimeManager())
}

export { defaultBuilders }
