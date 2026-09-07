import { CHANNEL_IDS, type ChannelId, type ChatRef } from "../channels/types"

/** 解析逗号/空白分隔的 QQ 列表,过滤非法项并去重 */
export function parseQQList(raw: string | undefined): number[] {
  if (!raw?.trim()) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const part of raw.split(/[,\s]+/)) {
    const n = Number(part)
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * 解析逗号/空白分隔的 chat id 列表,trim + 去重,保留字符串原样。
 * 用于 Telegram：负 id / 大整数绝不能 Number()。
 */
export function parseChatIdList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,\s]+/)) {
    const s = part.trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

const channelIds = new Set<string>(CHANNEL_IDS)

function isChannelId(v: unknown): v is ChannelId {
  return typeof v === "string" && channelIds.has(v)
}

/** 规范化 chat-ref 列表：校验 channel/chatId、去重 */
export function normalizeChatRefs(raw: unknown): ChatRef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ChatRef[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as { channel?: unknown; chatId?: unknown }
    if (!isChannelId(o.channel)) continue
    const chatId = String(o.chatId ?? "").trim()
    if (!chatId) continue
    const k = `${o.channel}:${chatId}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ channel: o.channel, chatId })
  }
  return out
}

/**
 * 管理面与生效会话互斥：管理群只跑管理命令，不进客服流程。
 * 后台误勾 / 旧库残留一律在写路径剔除。
 */
export function excludeAdminSurface(
  chats: ChatRef[],
  admin: ChatRef | null
): ChatRef[] {
  if (!admin) return chats
  return chats.filter(
    (c) => !(c.channel === admin.channel && c.chatId === admin.chatId)
  )
}

/** 规范化管理面：合法 chat-ref 或 null */
export function normalizeAdminSurface(raw: unknown): ChatRef | null {
  if (raw == null) return null
  if (typeof raw !== "object") return null
  const o = raw as { channel?: unknown; chatId?: unknown }
  if (!isChannelId(o.channel)) return null
  const chatId = String(o.chatId ?? "").trim()
  if (!chatId) return null
  return { channel: o.channel, chatId }
}

/**
 * 从 legacy 双字段派生 enabledChats（仅 migrate 路径使用）。
 * enabledGroups → qq；telegramEnabledChats → tg。
 */
export function enabledChatsFromLegacy(
  enabledGroups: number[] = [],
  telegramEnabledChats: string[] = []
): ChatRef[] {
  const out: ChatRef[] = []
  for (const gid of enabledGroups) {
    if (!Number.isFinite(gid) || gid <= 0) continue
    out.push({ channel: "qq", chatId: String(gid) })
  }
  for (const chatId of telegramEnabledChats) {
    const s = String(chatId).trim()
    if (!s) continue
    out.push({ channel: "tg", chatId: s })
  }
  return out
}
