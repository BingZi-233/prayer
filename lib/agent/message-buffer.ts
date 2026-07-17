import { bus } from "../bus"
import type { Repo } from "../db/repo"
import type { IncomingMessage } from "../events"
import {
  isAdminSurface,
  isChatEnabled,
  type ChatRef,
} from "../channels/enabled-chats"

export interface MessageBufferDeps {
  repo: Repo
  botQQ: number
  /** 统一生效会话 */
  enabledChats: ChatRef[]
  /** 管理面：不缓冲 */
  adminSurface: ChatRef | null
}

// 旁路缓冲:每条用户群消息落 group_messages,供反思轮询回看。
// 排除管理面、bot 自己、空文本、非生效会话;不做 @bot 过滤(反思要看全量对话上下文)。
export function registerMessageBuffer(deps: MessageBufferDeps): () => void {
  const { repo, botQQ, enabledChats, adminSurface } = deps
  const botId = String(botQQ)
  const enabledCfg = { enabledChats }

  const onReceived = (msg: IncomingMessage) => {
    const { channel, chatId, userId } = msg
    // 管理面不缓冲
    if (isAdminSurface(adminSurface, channel, chatId)) return
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
