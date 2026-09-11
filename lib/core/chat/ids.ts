import type { ChannelId } from "./types"

/** 已知通道集合；解析时校验首段 */
const CHANNELS = new Set<string>(["qq", "tg", "discord"])

export interface ParsedSessionKey {
  channel: ChannelId
  chatId: string
  userId: string
}

/** sessionKey = `${channel}:${chatId}:${userId}` */
export function makeSessionKey(
  channel: ChannelId,
  chatId: string,
  userId: string
): string {
  return `${channel}:${chatId}:${userId}`
}

/** dedupeKey = `${channel}:${chatId}:${messageId}` */
export function makeDedupeKey(
  channel: ChannelId,
  chatId: string,
  messageId: string
): string {
  return `${channel}:${chatId}:${messageId}`
}

/** chatRef = `${channel}:${chatId}`（白名单 / 游标 / policy） */
export function makeChatRef(channel: ChannelId, chatId: string): string {
  return `${channel}:${chatId}`
}

/**
 * 唯一合法 sessionKey 解析器。
 * 首段 channel、末段 userId、中间全部为 chatId（支持 TG 负 chatId）。
 */
export function parseSessionKey(key: string): ParsedSessionKey | null {
  if (!key) return null

  const parts = key.split(":")
  // 至少 channel + chatId + userId 三段
  if (parts.length < 3) return null

  const channel = parts[0]
  if (!CHANNELS.has(channel)) return null

  const userId = parts[parts.length - 1]
  const chatId = parts.slice(1, -1).join(":")

  if (!chatId || !userId) return null

  return {
    channel: channel as ChannelId,
    chatId,
    userId,
  }
}

/**
 * 将历史 QQ 两段键 `gid:uid` 升级为 `qq:gid:uid`。
 * 已是合法三元键则返回规范形式；无法识别则原样返回。
 */
export function legacySessionKeyToCanonical(key: string): string {
  const parsed = parseSessionKey(key)
  if (parsed) {
    return makeSessionKey(parsed.channel, parsed.chatId, parsed.userId)
  }

  const m = /^(\d+):(\d+)$/.exec(key)
  if (m) {
    return makeSessionKey("qq", m[1], m[2])
  }

  return key
}
