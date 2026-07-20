import type { Repo } from "./db/repo"
import type { Agent } from "./agent/agent"
import { SessionStore } from "./agent/session"
import { registerGateway } from "./agent/gateway"
import { registerOrchestrator } from "./agent/orchestrator"
import { makeIntentClassifier } from "./agent/intent"
import { registerReplyMapper } from "./agent/reply-mapper"
import { registerMessageBuffer } from "./agent/message-buffer"
import { registerTopicPoller } from "./agent/topic-poller"
import { registerReflectionPoller } from "./agent/reflection-poller"
import { registerReflectionCompactor } from "./agent/reflection-compactor"
import { registerReflectionPromoter } from "./agent/reflection-promoter"
import { registerErrorHandler } from "./agent/error-handler"
import { registerUnansweredPoller } from "./agent/unanswered-poller"
import { makeAnswerabilityClassifier } from "./agent/answerability"
import { registerHandoffHandler } from "./agent/handoff-handler"
import { registerResolutionRecorder } from "./agent/resolution-recorder"
import type { GroupPolicy } from "./config-store"
import type { ChannelId, ChatRef } from "./channels/types"
import { getGroupPolicy } from "./channels/enabled-chats"

export interface AssembleDeps {
  repo: Repo
  botQQ: number
  /** 额外监听 AT 的 QQ,与 botQQ 一并视为 bot 触发 */
  extraAtQQs?: number[]
  /** 统一生效会话白名单 */
  enabledChats?: ChatRef[]
  /** 管理命令 + 转人工通知面；null/缺省 = 无管理面 */
  adminSurface?: ChatRef | null
  /**
   * per-chat 旁路查询（ChannelRegistry.isBypassEnabled）。
   * 反思 / 主题 / 主动补位共用；缺省恒 true。
   */
  isBypassEnabled?: (channel: ChannelId, chatId: string) => boolean
  agent: Agent
  reflectScanMs?: number
  reflectLookbackMs?: number
  reflectSettleMs?: number
  reflectWindowMax?: number
  reflectCompactMs?: number
  reflectCompactMinEntries?: number
  reflectPromoteMs?: number
  reflectPromoteMinEntries?: number
  reflectPromoteMaxPerRun?: number
  // 反思沉淀/整理后是否通知管理群。缺省 true(保持既有行为)
  reflectNotifyAdmin?: boolean
  // 会话空闲超时(ms):超时则下条消息开全新对话,不 resume 旧会话。缺省 5 分钟
  resumeTtlMs?: number
  proactiveEnabled?: boolean
  proactiveScanMs?: number
  proactiveSilenceMs?: number
  proactiveMaxPerScan?: number
  handoffTimeoutMin?: number
  supportUrl?: string
  ackEnabled?: boolean
  maxReplyChars?: number
  topicScanMs?: number
  topicSettleMs?: number
  topicWindowMax?: number
  topicPromptMax?: number
  groupPolicies?: Record<string, GroupPolicy>
}

// 会话空闲 TTL 默认值:5 分钟无活动 → 新开对话
const DEFAULT_RESUME_TTL_MS = 300_000

/** 装配全链路,返回 teardown 用于热重载时卸载监听器与定时器 */
export function assemble(deps: AssembleDeps): () => void {
  const { repo, botQQ, agent } = deps
  const notifyAdmin = deps.reflectNotifyAdmin ?? true
  const policies = deps.groupPolicies ?? {}
  const store = new SessionStore(
    repo,
    deps.resumeTtlMs ?? DEFAULT_RESUME_TTL_MS
  )

  const enabledChats = deps.enabledChats ?? []
  const adminSurface = deps.adminSurface ?? null

  const shouldNotifyHandoff = (channel: ChannelId, chatId: string) => {
    const p = getGroupPolicy({ groupPolicies: policies }, channel, chatId)
    if (p?.notifyAdminOnHandoff !== undefined) return p.notifyAdminOnHandoff
    return true
  }

  // 主动补位:全局开,或任一群策略显式开
  const anyGroupProactive = Object.values(policies).some(
    (p) => p.proactiveEnabled === true
  )
  const proactiveOn = !!deps.proactiveEnabled || anyGroupProactive

  const cleanups = [
    registerResolutionRecorder(repo),
    registerErrorHandler({ supportUrl: deps.supportUrl }),
    registerHandoffHandler({
      repo,
      adminSurface,
      handoffTimeoutMin: deps.handoffTimeoutMin ?? 30,
      shouldNotify: shouldNotifyHandoff,
    }),
    // gateway 必须先于 message-buffer 注册:同 tick 内 prior 回看时当前消息尚未入库;
    // excludeMessageId 是双保险,防止当前触发消息被误纳入 prior。
    registerGateway({
      repo,
      botQQ,
      extraAtQQs: deps.extraAtQQs,
      enabledChats,
      adminSurface,
      supportUrl: deps.supportUrl,
    }),
    registerOrchestrator({
      agent,
      store,
      classify: makeIntentClassifier(),
      ackEnabled: deps.ackEnabled !== false,
    }),
    registerReplyMapper({ maxChars: deps.maxReplyChars ?? 900 }),
    registerMessageBuffer({
      repo,
      botQQ,
      enabledChats,
      adminSurface,
    }),
    registerTopicPoller({
      repo,
      enabledChats,
      scanMs: deps.topicScanMs,
      settleMs: deps.topicSettleMs,
      windowMax: deps.topicWindowMax,
      topicPromptMax: deps.topicPromptMax,
      isBypassEnabled: deps.isBypassEnabled,
    }),
    registerReflectionPoller({
      repo,
      enabledChats,
      adminSurface,
      scanMs: deps.reflectScanMs,
      lookbackMs: deps.reflectLookbackMs,
      settleMs: deps.reflectSettleMs,
      windowMax: deps.reflectWindowMax,
      notifyAdmin,
      isBypassEnabled: deps.isBypassEnabled,
    }),
  ]
  if ((deps.reflectCompactMs ?? 86_400_000) > 0) {
    cleanups.push(
      registerReflectionCompactor({
        repo,
        adminSurface,
        compactMs: deps.reflectCompactMs,
        minEntries: deps.reflectCompactMinEntries,
        notifyAdmin,
      })
    )
  }
  if ((deps.reflectPromoteMs ?? 86_400_000) > 0) {
    cleanups.push(
      registerReflectionPromoter({
        repo,
        adminSurface,
        promoteMs: deps.reflectPromoteMs,
        minEntries: deps.reflectPromoteMinEntries,
        maxPerRun: deps.reflectPromoteMaxPerRun,
        notifyAdmin,
      })
    )
  }
  if (proactiveOn) {
    cleanups.push(
      registerUnansweredPoller({
        repo,
        agent,
        store,
        classify: makeAnswerabilityClassifier(),
        enabledChats,
        adminSurface,
        scanMs: deps.proactiveScanMs,
        silenceMs: deps.proactiveSilenceMs,
        maxPerScan: deps.proactiveMaxPerScan,
        // 全局关时,只扫策略显式开启的群
        globalProactiveEnabled: !!deps.proactiveEnabled,
        groupPolicies: policies,
        isBypassEnabled: deps.isBypassEnabled,
      })
    )
  }
  return () => cleanups.forEach((c) => c())
}
