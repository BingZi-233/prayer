import { bus } from "../bus"
import { logger } from "../logger"
import type { Repo } from "../db/repo"
import type { Agent } from "./agent"
import { AGENT_FALLBACK_TEXT, isNoAnswerText, PROACTIVE_SUFFIX } from "./agent"
import type { SessionStore } from "./session"
import type { AnswerabilityClassifier } from "./answerability"
import type { GroupPolicy } from "../config-store"
import type { ChannelId } from "../channels/types"
import { makeSessionKey } from "../channels/ids"
import {
  getGroupPolicy,
  isAdminSurface,
  type ChatRef,
} from "../channels/enabled-chats"

// 主动模式指令改定义在 agent.ts:预检索要按它剥前缀才能拿到干净的检索 query
// (见 kbProbeText),常量留在这边会形成 agent → poller 的循环依赖。

export interface UnansweredPollerDeps {
  repo: Repo
  agent: Agent
  store: SessionStore
  classify: AnswerabilityClassifier
  /** 统一生效会话 */
  enabledChats: ChatRef[]
  adminSurface: ChatRef | null
  scanMs?: number
  silenceMs?: number
  maxPerScan?: number
  now?: () => number
  /** 全局主动开关 */
  globalProactiveEnabled?: boolean
  groupPolicies?: Record<string, GroupPolicy>
  /**
   * per-chat 旁路是否可用（ChannelRegistry 注入）。
   * 缺省恒 true。
   */
  isBypassEnabled?: (channel: ChannelId, chatId: string) => boolean
}

interface Resolved {
  repo: Repo
  agent: Agent
  store: SessionStore
  classify: AnswerabilityClassifier
  adminSurface: ChatRef | null
  enabledChats: ChatRef[]
  silenceMs: number
  maxPerScan: number
  now: () => number
  globalProactiveEnabled: boolean
  groupPolicies: Record<string, GroupPolicy>
  isBypassEnabled: (channel: ChannelId, chatId: string) => boolean
}

function resolve(d: UnansweredPollerDeps): Resolved {
  return {
    repo: d.repo,
    agent: d.agent,
    store: d.store,
    classify: d.classify,
    adminSurface: d.adminSurface,
    enabledChats: d.enabledChats,
    silenceMs: d.silenceMs ?? 180_000,
    maxPerScan: d.maxPerScan ?? 2,
    now: d.now ?? (() => Date.now()),
    globalProactiveEnabled: d.globalProactiveEnabled ?? true,
    groupPolicies: d.groupPolicies ?? {},
    isBypassEnabled: d.isBypassEnabled ?? (() => true),
  }
}

function chatPolicy(
  d: Resolved,
  channel: ChannelId,
  chatId: string
): GroupPolicy | undefined {
  return getGroupPolicy({ groupPolicies: d.groupPolicies }, channel, chatId)
}

function chatEnabled(d: Resolved, channel: ChannelId, chatId: string): boolean {
  const p = chatPolicy(d, channel, chatId)
  if (p?.proactiveEnabled !== undefined) return p.proactiveEnabled
  return d.globalProactiveEnabled
}

function chatSilence(d: Resolved, channel: ChannelId, chatId: string): number {
  const p = chatPolicy(d, channel, chatId)
  if (p?.proactiveSilenceMs !== undefined) return p.proactiveSilenceMs
  return d.silenceMs
}

// 真答案判定:非空、不含哨兵、且不是 agent 降级兜底文案。撞任一 → 沉默。
function isAnswer(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && !isNoAnswerText(t) && t !== AGENT_FALLBACK_TEXT
}

async function scanOnce(d: Resolved): Promise<void> {
  const now = d.now()

  for (const { channel, chatId } of d.enabledChats) {
    if (isAdminSurface(d.adminSurface, channel, chatId)) continue
    // 旁路降级：由 channel.isBypassEnabled 决定
    if (!d.isBypassEnabled(channel, chatId)) continue
    if (!chatEnabled(d, channel, chatId)) continue
    const silenceMs = chatSilence(d, channel, chatId)
    const until = now - silenceMs
    if (until <= 0) continue

    try {
      const cursor = d.repo.groupProactiveCursor(channel, chatId)
      if (until <= cursor) continue // 无新沉降
      // 冷启动:首见该会话 → 只推进游标,绝不回答上线前积压
      if (cursor === 0) {
        d.repo.setGroupProactiveCursor(channel, chatId, until)
        continue
      }

      const rows = d.repo.groupMemberMessagesBetween(
        channel,
        chatId,
        cursor,
        until
      )
      // 每用户取 band 内最新一条为代表(questionTs=最新),对两条压制都是最宽松取值:
      // 只要用户最后一句仍无人应答就兜底。前文多句升序拼进 text 作上下文。
      const byUser = new Map<
        string,
        { text: string; questionTs: number; messageId: string | null }
      >()
      for (const r of rows) {
        const prev = byUser.get(r.userId)
        byUser.set(r.userId, {
          text: prev ? `${prev.text}\n${r.text}` : r.text,
          questionTs: r.createdAt,
          messageId: r.messageId, // 代表 = band 内最后一条,引用它
        })
      }

      let hits = 0
      let capped = false
      for (const [userId, { text, questionTs, messageId }] of byUser) {
        if (hits >= d.maxPerScan) {
          capped = true
          break
        }
        // 压制①:问题后(至 now)会话里有 owner/admin 发言 → 人工接管
        if (d.repo.hasAdminMessageBetween(channel, chatId, questionTs, now))
          continue
        // 压制②:该用户会话已被主链路 @处理/已兜底过(setSessionId 刷了 updated_at)。
        // 注:被意图门拦截的 @bot 消息不 remember → 不走此路,靠 fail-closed 判官兜住。
        const key = makeSessionKey(channel, chatId, userId)
        // human-mode 不抢答
        if (d.repo.isHumanMode(key)) continue
        const upd = d.repo.sessionUpdatedAt(key)
        if (upd !== undefined && upd > questionTs) continue
        // 门1:可答性
        if (!(await d.classify(text))) {
          bus.emit("resolution.recorded", {
            kind: "proactive_silent",
            sessionKey: key,
            channel,
            chatId,
            userId,
            detail: "not_answerable",
          })
          continue
        }
        // 门2:复用主链路 agent,带哨兵。
        // 主动模式指令并入 user prompt(而非 system 后缀):使主动/正常两路径 system 前缀恒等,
        // TTL 内可跨路径命中缓存(~1.5k token 的 system 只需写一次)。行为等价(单轮指令)。
        // 故意不 resume 主会话:若续接,哨兵指令与 __NO_ANSWER__ 会写进 transcript,
        // 后续 @ 主链路可能复读哨兵并外发(主链路原先无过滤)。真答案才 remember 新 session。
        const result = await d.agent.run(
          `${PROACTIVE_SUFFIX}\n\n${text}`,
          undefined,
          { sessionKey: key, channel, chatId, userId }
        )
        if (!isAnswer(result.text)) {
          bus.emit("resolution.recorded", {
            kind: "proactive_silent",
            sessionKey: key,
            channel,
            chatId,
            userId,
            detail: "no_answer",
          })
          continue // 哨兵/空 → 沉默
        }
        if (result.sessionId) d.store.remember(key, result.sessionId)
        d.repo.insertProactiveReply(channel, chatId, userId, text, result.text) // 留痕供监控页
        bus.emit("reply.ready", {
          channel,
          chatId,
          text: result.text,
          replyToId: messageId ?? undefined,
        })
        bus.emit("resolution.recorded", {
          kind: "proactive",
          sessionKey: key,
          channel,
          chatId,
          userId,
        })
        logger.log(
          "info",
          `[proactive] ${channel}:${chatId} 主动回答用户 ${userId}`
        )
        hits++
      }

      // 命中上限时不推进游标:下轮已答用户被压制②挡下,自然轮到溢出用户;避免答案被永久丢弃
      if (!capped) d.repo.setGroupProactiveCursor(channel, chatId, until)
    } catch (err) {
      // 单会话失败不牵连其他;该会话不推进游标 → 下轮重试
      bus.emit("error.occurred", {
        scope: "proactive",
        err,
        channel,
        chatId,
      })
    }
  }
}

// 供测试直接驱动一次扫描
export async function runScan(deps: UnansweredPollerDeps): Promise<void> {
  await scanOnce(resolve(deps))
}

// 监听式装配:定时扫描,返回 teardown。旁路观察者,失败不阻断主链路。
export function registerUnansweredPoller(
  deps: UnansweredPollerDeps
): () => void {
  const d = resolve(deps)
  // 秒级扫描可配;下限 1s 防 setInterval(0) 空转打爆 CPU
  const scanMs = Math.max(1_000, deps.scanMs ?? 60_000)
  let running = false // 防重入:上一轮未结束则跳过本次触发,避免重复兜底
  const timer = setInterval(() => {
    if (running) return
    running = true
    void scanOnce(d)
      .catch((err) => bus.emit("error.occurred", { scope: "proactive", err }))
      .finally(() => {
        running = false
      })
  }, scanMs)
  return () => clearInterval(timer)
}
