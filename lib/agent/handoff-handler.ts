import { bus } from "../bus"
import type { Repo } from "../db/repo"
import type { HandoffRequested, HandoffResumed } from "../events"
import type { ChannelId } from "../channels/types"
import {
  legacySessionKeyToCanonical,
  parseSessionKey,
} from "../channels/ids"

export interface HandoffHandlerDeps {
  repo: Repo
  adminGroupId: number
  handoffTimeoutMin: number
  /** 转人工时是否通知管理群;默认 true。也可按事件 reason 覆盖 */
  notifyAdmin?: boolean
  /** 群策略:某会话是否通知管理群 */
  shouldNotify?: (channel: ChannelId, chatId: string) => boolean
  now?: () => number
  /** 超时扫描周期 ms;默认 60s */
  scanMs?: number
}

export function registerHandoffHandler(deps: HandoffHandlerDeps): () => void {
  const {
    repo,
    adminGroupId,
    handoffTimeoutMin,
    notifyAdmin = true,
    shouldNotify,
    now = () => Date.now(),
    scanMs = 60_000,
  } = deps
  const adminChatId = String(adminGroupId)

  const onRequested = (e: HandoffRequested) => {
    // 已在人工模式 → 不重复通知(避免连刷「人工」)
    if (repo.isHumanMode(e.sessionKey)) {
      bus.emit("action.send", {
        channel: e.channel,
        chatId: e.chatId,
        text: "已经在为你转接人工客服,请稍等~",
      })
      return
    }

    repo.setHumanMode(e.sessionKey, true)
    if (e.lastQuestion) repo.setLastQuestion(e.sessionKey, e.lastQuestion)
    repo.insertResolution("handoff", {
      sessionKey: e.sessionKey,
      channel: e.channel,
      chatId: e.chatId,
      userId: e.userId,
      detail: "human",
    })

    bus.emit("action.send", {
      channel: e.channel,
      chatId: e.chatId,
      text: "已为你转接人工客服,群管看到后会尽快回复。期间我先不插话。",
    })

    const doNotify = shouldNotify
      ? shouldNotify(e.channel, e.chatId)
      : notifyAdmin
    if (doNotify && adminGroupId > 0) {
      const q = (e.lastQuestion || "").slice(0, 200)
      bus.emit("action.send", {
        channel: "qq",
        chatId: adminChatId,
        text: `【转人工】会话 ${e.sessionKey}\n用户 ${e.userId} 在 ${e.channel}:${e.chatId}\n问题:${q || "(无)"}\n恢复自动答:!resume ${e.sessionKey}`,
      })
    }
  }

  const onResumed = (e: HandoffResumed) => {
    if (!repo.isHumanMode(e.sessionKey)) return
    repo.setHumanMode(e.sessionKey, false)

    // 用 parseSessionKey(兼容历史两段键),禁止 Number(sessionKey.split(":")[0])
    const parsed = parseSessionKey(
      legacySessionKeyToCanonical(e.sessionKey)
    )
    if (parsed) {
      bus.emit("action.send", {
        channel: parsed.channel,
        chatId: parsed.chatId,
        text: "已恢复自动客服,有问题 @我 即可~",
      })
    }
    if (adminGroupId > 0) {
      bus.emit("action.send", {
        channel: "qq",
        chatId: adminChatId,
        text: `已恢复自动答: ${e.sessionKey}${e.by ? ` (${e.by})` : ""}`,
      })
    }
  }

  const tick = () => {
    try {
      const cutoff = now() - handoffTimeoutMin * 60_000
      for (const key of repo.expiredHumanSessions(cutoff)) {
        bus.emit("handoff.resumed", { sessionKey: key, by: "timeout" })
      }
    } catch (err) {
      bus.emit("error.occurred", { scope: "handoff-timeout", err })
    }
  }

  bus.on("handoff.requested", onRequested)
  bus.on("handoff.resumed", onResumed)
  const timer = setInterval(tick, scanMs)
  // 启动时也扫一次,避免长时间未启动积压
  tick()

  return () => {
    bus.off("handoff.requested", onRequested)
    bus.off("handoff.resumed", onResumed)
    clearInterval(timer)
  }
}
