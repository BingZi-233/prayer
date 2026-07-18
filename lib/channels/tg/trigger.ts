import type { MessageEntity } from "grammy/types"

/** 规范化 TG username：去前导 @、小写 */
export function normalizeUsername(username: string): string {
  return username.replace(/^@+/, "").toLowerCase()
}

/**
 * 从文本按 entity 的 UTF-16 offset/length 切片。
 * JS 字符串本身按 UTF-16 code unit 索引，与 Telegram 实体偏移一致。
 */
export function utf16Slice(
  text: string,
  offset: number,
  length: number
): string {
  return text.slice(offset, offset + length)
}

export interface MentionableMessage {
  text?: string
  caption?: string
  entities?: MessageEntity[]
  caption_entities?: MessageEntity[]
}

function messageTextAndEntities(message: MentionableMessage): {
  text: string
  entities: MessageEntity[]
} {
  if (message.text != null) {
    return { text: message.text, entities: message.entities ?? [] }
  }
  if (message.caption != null) {
    return { text: message.caption, entities: message.caption_entities ?? [] }
  }
  return { text: "", entities: [] }
}

/** 判断消息是否 @ 了本 bot（mention / text_mention） */
export function isBotMentioned(
  message: MentionableMessage,
  botUsername: string,
  botId: number
): boolean {
  const { text, entities } = messageTextAndEntities(message)
  if (!entities.length) return false

  const botUserNorm = normalizeUsername(botUsername)
  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user?.id === botId) {
      return true
    }
    if (entity.type === "mention") {
      const mentionText = utf16Slice(text, entity.offset, entity.length)
      if (normalizeUsername(mentionText) === botUserNorm) {
        return true
      }
    }
  }
  return false
}

/**
 * 从文本中剥离对本 bot 的 mention / text_mention。
 * 使用 Telegram entity 的 UTF-16 offset/length，自后向前删除以免偏移错位。
 */
export function stripBotMention(
  text: string,
  entities: MessageEntity[] | undefined,
  botUsername: string,
  botId: number
): string {
  if (!text) return ""
  if (!entities?.length) return text.trim()

  const botUserNorm = normalizeUsername(botUsername)
  const toStrip: { offset: number; length: number }[] = []

  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user?.id === botId) {
      toStrip.push({ offset: entity.offset, length: entity.length })
      continue
    }
    if (entity.type === "mention") {
      const mentionText = utf16Slice(text, entity.offset, entity.length)
      if (normalizeUsername(mentionText) === botUserNorm) {
        toStrip.push({ offset: entity.offset, length: entity.length })
      }
    }
  }

  if (!toStrip.length) return text.trim()

  // 从后往前删，保持前面 entity 偏移有效
  toStrip.sort((a, b) => b.offset - a.offset)
  let result = text
  for (const { offset, length } of toStrip) {
    result = result.slice(0, offset) + result.slice(offset + length)
  }
  return result.trim()
}
