import { bus } from "../bus"
import type { Repo } from "../db/repo"
import type { IncomingMessage } from "../events"
import { isChatEnabled } from "../channels/enabled-chats"
import type { AppConfig } from "../config-store"

export interface MessageBufferDeps {
  repo: Repo
  botQQ: number
  adminGroupId: number
  enabledGroups: number[]
  /** TG 白名单 chatId；缺省空 */
  telegramEnabledChats?: string[]
}

// 旁路缓冲:每条用户群消息落 group_messages,供反思轮询回看。
// 排除管理群、bot 自己、空文本、非生效会话;不做 @bot 过滤(反思要看全量对话上下文)。
export function registerMessageBuffer(deps: MessageBufferDeps): () => void {
  const {
    repo,
    botQQ,
    adminGroupId,
    enabledGroups,
    telegramEnabledChats = [],
  } = deps
  const botId = String(botQQ)
  const adminChatId = String(adminGroupId)
  // isChatEnabled 只读这两项
  const enabledCfg = {
    enabledGroups,
    telegramEnabledChats,
  } as Pick<AppConfig, "enabledGroups" | "telegramEnabledChats"> as AppConfig

  const onReceived = (msg: IncomingMessage) => {
    const { channel, chatId, userId } = msg
    // 管理群仅 QQ,不缓冲
    if (channel === "qq" && chatId === adminChatId) return
    // bot 自己:字符串比较(userId 已是 string)
    if (userId === botId) return
    if (!msg.rawText?.trim()) return
    if (!isChatEnabled(enabledCfg, channel, chatId)) return
    try {
      repo.bufferGroupMessage(
        channel,
        chatId,
        userId,
        msg.senderRole ?? null,
        msg.rawText,
        msg.messageId
      )
    } catch (err) {
      bus.emit("error.occurred", { scope: "message-buffer", err })
    }
  }

  bus.on("message.received", onReceived)
  return () => bus.off("message.received", onReceived)
}
