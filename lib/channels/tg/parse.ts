import type {
  Message,
  MessageEntity,
  MessageOrigin,
  Update,
} from "grammy/types"
import type { IncomingMessage } from "@/lib/events"
import { isBotMentioned, stripBotMention } from "./trigger"

export interface TelegramParseContext {
  botId: number
  botUsername: string
}

/**
 * Telegram Update → IncomingMessage。
 * 仅处理群/超级群的 message；忽略 edited_message、private、channel、forum thread。
 * Phase 1 不下载媒体；senderRole 留给 admins-cache（Phase 2）。
 */
export function parseTelegramUpdate(
  update: Update,
  ctx: TelegramParseContext
): IncomingMessage | null {
  // 只处理 message，忽略 edited_message 等
  const message = update.message
  if (!message) return null

  const chatType = message.chat?.type
  if (chatType !== "group" && chatType !== "supergroup") return null

  // forum topic 消息回错 General，整条丢弃
  if (message.message_thread_id != null) return null

  const from = message.from
  if (!from) return null

  const text = message.text ?? message.caption ?? ""
  const entities: MessageEntity[] | undefined =
    message.entities ?? message.caption_entities

  const botMentioned = isBotMentioned(message, ctx.botUsername, ctx.botId)
  const rawText = stripBotMention(text, entities, ctx.botUsername, ctx.botId)

  return {
    channel: "tg",
    chatId: String(message.chat.id),
    userId: String(from.id),
    messageId: String(message.message_id),
    rawText,
    atList: collectAtList(entities),
    botMentioned,
    quoted: extractQuoted(message),
    forwarded: extractForwarded(message),
    images: [],
  }
}

/** text_mention 可直接取 user id；普通 mention 只有 username，无 id 则跳过 */
function collectAtList(entities: MessageEntity[] | undefined): string[] {
  if (!entities?.length) return []
  const ids: string[] = []
  for (const e of entities) {
    if (e.type === "text_mention" && e.user?.id != null) {
      ids.push(String(e.user.id))
    }
  }
  return ids
}

function extractQuoted(message: Message): string | undefined {
  const reply = message.reply_to_message
  if (!reply) return undefined
  const t = reply.text ?? reply.caption
  return t || undefined
}

/** 尽力从 forward_origin / 旧 forward_* 字段拼来源描述（非合并转发全文） */
function extractForwarded(message: Message): string | undefined {
  if (message.forward_origin) {
    return formatForwardOrigin(message.forward_origin)
  }
  // 旧 Bot API 字段（部分客户端/日志仍可能出现）
  const legacy = message as Message & {
    forward_from?: {
      first_name?: string
      last_name?: string
      username?: string
    }
    forward_from_chat?: { title?: string }
    forward_sender_name?: string
  }
  if (legacy.forward_from) {
    return formatUserName(legacy.forward_from)
  }
  if (legacy.forward_from_chat?.title) {
    return legacy.forward_from_chat.title
  }
  if (legacy.forward_sender_name) {
    return legacy.forward_sender_name
  }
  return undefined
}

function formatForwardOrigin(origin: MessageOrigin): string | undefined {
  switch (origin.type) {
    case "user":
      return formatUserName(origin.sender_user)
    case "hidden_user":
      return origin.sender_user_name || undefined
    case "chat":
      return origin.sender_chat.title || origin.author_signature || undefined
    case "channel":
      return origin.chat.title || origin.author_signature || undefined
    default:
      return undefined
  }
}

function formatUserName(user: {
  first_name?: string
  last_name?: string
  username?: string
}): string | undefined {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ")
  if (name) return name
  if (user.username) return `@${user.username}`
  return undefined
}
