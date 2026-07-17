import { bus } from "../bus"
import type { Repo } from "../db/repo"
import type { IncomingMessage } from "../events"
import type { ChannelId } from "../channels/types"
import { makeDedupeKey, makeSessionKey } from "../channels/ids"
import { isChatEnabled } from "../channels/enabled-chats"
import type { AppConfig } from "../config-store"

export interface GatewayDeps {
  repo: Repo
  botQQ: number
  /** 额外监听的 QQ:atList 命中其中任一时也当 @bot */
  extraAtQQs?: number[]
  adminGroupId: number
  enabledGroups: number[]
  /** TG 白名单 chatId；缺省空 */
  telegramEnabledChats?: string[]
  /** 固定支持链接,办不了/人工时附带 */
  supportUrl?: string
}

// 用户自助重置对话的关键词(整条消息精确匹配,避免误触)
const RESET_KEYWORDS =
  /^\s*(重新开始|重置对话|重置会话|重置|\/new|\/reset|\/clear)\s*$/i

// 转人工关键词(整条消息)
const HANDOFF_KEYWORDS = /^\s*(人工|转人工|人工客服|转接人工|客服)\s*$/i

// 用法说明
const HELP_KEYWORDS = /^\s*(帮助|怎么用|使用说明|\/help|help)\s*$/i

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
  const {
    repo,
    botQQ,
    adminGroupId,
    enabledGroups,
    supportUrl,
    telegramEnabledChats = [],
  } = deps
  const extraAtQQs = (deps.extraAtQQs ?? []).map(String)
  const botQQStr = String(botQQ)
  const adminChatId = String(adminGroupId)
  // isChatEnabled 只读这两项;其余 AppConfig 字段不在此路径使用
  const enabledCfg = {
    enabledGroups,
    telegramEnabledChats,
  } as Pick<AppConfig, "enabledGroups" | "telegramEnabledChats"> as AppConfig

  const onReceived = (msg: IncomingMessage) => {
    const { channel, chatId, userId, messageId } = msg
    const isAdminGroup = channel === "qq" && chatId === adminChatId

    // 生效会话门:非白名单且非 QQ 管理群 → 完全忽略
    if (!isAdminGroup && !isChatEnabled(enabledCfg, channel, chatId)) return

    // 管理群命令优先(仅 QQ 管理群)
    if (isAdminGroup) {
      const mReset = msg.rawText.match(/^!reset\s+(\S+)/)
      if (mReset) {
        repo.clearResumeId(mReset[1])
        sendText(
          "qq",
          adminChatId,
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
    if (!msg.rawText && !msg.images?.length) return // 纯图消息也放行

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

    // 转人工
    if (HANDOFF_KEYWORDS.test(msg.rawText)) {
      // TG:一期无管理侧队列,只回用户引导文案,不发 handoff.requested
      if (channel === "tg") {
        const link = supportUrl
          ? ` 也可访问 ${supportUrl} 联系支持。`
          : ""
        sendText(
          channel,
          chatId,
          `当前频道暂不支持群内转人工,请通过官网支持渠道联系客服。${link}`.trim(),
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
