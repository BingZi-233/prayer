import { bus } from "../bus"
import type { Repo } from "../db/repo"
import type { IncomingMessage } from "../events"
import type { ChannelId } from "../channels/types"
import { makeDedupeKey, makeSessionKey } from "../channels/ids"
import {
  isAdminSurface,
  isChatEnabled,
  type ChatRef,
} from "../channels/enabled-chats"
import {
  RESET_KEYWORDS,
  HANDOFF_KEYWORDS,
  HELP_KEYWORDS,
} from "./command-keywords"

export interface GatewayDeps {
  repo: Repo
  botQQ: number
  /** 额外监听的 QQ:atList 命中其中任一时也当 @bot */
  extraAtQQs?: number[]
  /** 统一生效会话（chat-ref）；由 assemble 从 config 解析后注入 */
  enabledChats: ChatRef[]
  /**
   * 管理命令面 + 转人工通知目标。
   * null = 无管理侧（人工关键词改引导官网）。
   */
  adminSurface: ChatRef | null
  /** 固定支持链接,办不了/人工时附带 */
  supportUrl?: string
}

function helpText(supportUrl?: string): string {
  const link = supportUrl ? `\n官网:${supportUrl}` : ""
  return `用法说明:问我请 @我;重置对话发「重置」;需要人工发「人工」。${link}`
}

/** atList 是否命中 bot 或任一额外监听 QQ(字符串 id) */
export function isAtTrigger(
  atList: string[],
  botQQ: string,
  extraAtQQs: string[] = []
): boolean {
  if (atList.includes(botQQ)) return true
  for (const qq of extraAtQQs) {
    if (Number(qq) > 0 && atList.includes(qq)) return true
  }
  return false
}

function sendText(
  channel: ChannelId,
  chatId: string,
  text: string,
  replyToId?: string
): void {
  bus.emit("action.send", { channel, chatId, text, replyToId })
}

export function registerGateway(deps: GatewayDeps): () => void {
  const { repo, botQQ, supportUrl, enabledChats, adminSurface } = deps
  const extraAtQQs = (deps.extraAtQQs ?? []).map(String)
  const botQQStr = String(botQQ)
  const enabledCfg = { enabledChats }

  const onReceived = (msg: IncomingMessage) => {
    const { channel, chatId, userId, messageId } = msg
    const onAdmin = isAdminSurface(adminSurface, channel, chatId)

    // 生效会话门:非白名单且非管理面 → 完全忽略
    if (!onAdmin && !isChatEnabled(enabledCfg, channel, chatId)) return

    // 管理面命令优先（!reset / !resume）
    if (onAdmin && adminSurface) {
      const mReset = msg.rawText.match(/^!reset\s+(\S+)/)
      if (mReset) {
        repo.clearResumeId(mReset[1])
        sendText(
          adminSurface.channel,
          adminSurface.chatId,
          `已重置会话 ${mReset[1]} 的对话上下文。`
        )
        return
      }
      const mResume = msg.rawText.match(/^!resume\s+(\S+)/)
      if (mResume) {
        bus.emit("handoff.resumed", { sessionKey: mResume[1], by: "admin" })
        return
      }
    }

    const triggered =
      msg.botMentioned ?? isAtTrigger(msg.atList, botQQStr, extraAtQQs)
    if (!triggered) return
    if (repo.seenMessage(makeDedupeKey(channel, chatId, messageId))) return
    const sessionKey = makeSessionKey(channel, chatId, userId)
    // 纯 @bot 无正文：回用法说明（常见「@ 了但无回复」）
    if (!msg.rawText?.trim() && !msg.images?.length) {
      sendText(channel, chatId, helpText(supportUrl), messageId)
      bus.emit("resolution.recorded", {
        kind: "ack",
        sessionKey,
        channel,
        chatId,
        userId,
        detail: "empty-after-mention",
      })
      return
    }

    // human-mode:已转人工 → 丢弃(不抢答)
    if (repo.isHumanMode(sessionKey)) {
      // 允许用户在人工模式发「重置」清上下文,但不自动答
      if (RESET_KEYWORDS.test(msg.rawText)) {
        repo.clearResumeId(sessionKey)
        sendText(
          channel,
          chatId,
          "已重置对话上下文。当前仍在人工接待中;管理恢复后我会再自动答。",
          messageId
        )
      }
      return
    }

    // 用户自助重置:清 resumeId,不转 Agent
    if (RESET_KEYWORDS.test(msg.rawText)) {
      repo.clearResumeId(sessionKey)
      sendText(channel, chatId, "已重置对话,我们重新开始吧~", messageId)
      bus.emit("resolution.recorded", {
        kind: "reset",
        sessionKey,
        channel,
        chatId,
        userId,
      })
      return
    }

    // 用法说明
    if (HELP_KEYWORDS.test(msg.rawText)) {
      sendText(channel, chatId, helpText(supportUrl), messageId)
      return
    }

    // 转人工：有管理面 → handoff 事件（通知走 adminSurface）；无管理面 → 引导官网
    if (HANDOFF_KEYWORDS.test(msg.rawText)) {
      if (!adminSurface) {
        const link = supportUrl
          ? ` 也可访问 ${supportUrl} 联系支持。`
          : ""
        sendText(
          channel,
          chatId,
          `当前未配置管理侧转人工通道,请通过官网支持渠道联系客服。${link}`.trim(),
          messageId
        )
        return
      }
      const lastQ =
        repo.listSessions().find((s) => s.key === sessionKey)?.lastQuestion ??
        msg.rawText
      bus.emit("handoff.requested", {
        channel,
        sessionKey,
        chatId,
        userId,
        lastQuestion: lastQ || "用户请求转人工",
        reason: "user",
      })
      return
    }

    // 记录最近问题,供列表预览 / 转人工摘要
    if (msg.rawText.trim()) {
      repo.setLastQuestion(sessionKey, msg.rawText.trim())
    }

    bus.emit("message.qualified", {
      channel,
      sessionKey,
      chatId,
      userId,
      messageId,
      text: msg.rawText,
      images: msg.images,
      quoted: msg.quoted,
      forwarded: msg.forwarded,
    })
  }

  bus.on("message.received", onReceived)
  return () => bus.off("message.received", onReceived)
}
