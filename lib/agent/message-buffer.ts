import { bus } from "../core/bus"
import type { Repo } from "../core/db/repo"
import type { IncomingMessage } from "../core/chat/events"
import {
  isAdminSurface,
  isChatEnabled,
  type ChatRef,
} from "../core/chat/enabled-chats"
import { isCommandMessage } from "./command-keywords"
import { isAtTrigger } from "./gateway"

export interface MessageBufferDeps {
  repo: Repo
  botQQ: number
  /** 额外监听的 QQ:atList 命中其中任一也算 @bot(与 gateway 口径一致) */
  extraAtQQs?: number[]
  /** 统一生效会话 */
  enabledChats: ChatRef[]
  /** 管理面：不缓冲 */
  adminSurface: ChatRef | null
}

// 旁路缓冲:每条用户群消息落 group_messages,供反思轮询回看。
// 排除管理面、bot 自己、空文本、整句命令、非生效会话;不做 @bot 过滤(反思要看全量对话上下文)。
export function registerMessageBuffer(deps: MessageBufferDeps): () => void {
  const { repo, botQQ, enabledChats, adminSurface } = deps
  const botId = String(botQQ)
  const extraAtQQs = (deps.extraAtQQs ?? []).map(String)
  const enabledCfg = { enabledChats }

  const onReceived = (msg: IncomingMessage) => {
    const { channel, chatId, userId } = msg
    // 管理面不缓冲
    if (isAdminSurface(adminSurface, channel, chatId)) return
    // bot 自己:字符串比较(userId 已是 string)
    if (userId === botId) return
    if (!msg.rawText?.trim()) return
    // 整句命令(重置/帮助/转人工)不入缓冲,避免污染 prior 上下文
    if (isCommandMessage(msg.rawText)) return
    if (!isChatEnabled(enabledCfg, channel, chatId)) return
    // @bot 消息打标:主链路在处理,主动补位扫描不拿它当「无人应答」候选
    const mentionedBot =
      msg.botMentioned ?? isAtTrigger(msg.atList, botId, extraAtQQs)
    try {
      repo.bufferGroupMessage(
        channel,
        chatId,
        userId,
        msg.senderRole ?? null,
        msg.rawText,
        msg.messageId,
        mentionedBot
      )
    } catch (err) {
      bus.emit("error.occurred", { scope: "message-buffer", err })
    }
  }

  bus.on("message.received", onReceived)
  return () => bus.off("message.received", onReceived)
}
