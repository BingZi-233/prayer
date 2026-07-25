/** 运行日志的上下文工具:错误文案抽取 + 从 sessionKey 反解 chat-ref */

import type { ChannelId } from "./channels/types"

/** 从 unknown 抽出错误文案 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export type ChatRefLog = { channel: ChannelId; chatId: string }

/**
 * 从 sessionKey 解析 chat-ref。
 * 支持规范键 `channel:chatId:userId` 与历史两段键 `groupId:userId`（视为 qq）。
 */
export function chatRefFromSession(
  sessionKey?: string
): ChatRefLog | undefined {
  if (!sessionKey) return undefined
  const parts = sessionKey.split(":")
  // 规范键 channel:chatId:userId（chatId 可含冒号）
  if (parts.length >= 3) {
    const channel = parts[0]
    if (channel === "qq" || channel === "tg" || channel === "discord") {
      const chatId = parts.slice(1, -1).join(":")
      if (chatId) return { channel, chatId }
    }
  }
  // 历史两段键 groupId:userId → qq
  if (parts.length === 2) {
    const n = Number(parts[0])
    if (Number.isFinite(n)) {
      return { channel: "qq", chatId: parts[0] }
    }
  }
  return undefined
}

/**
 * @deprecated 用 chatRefFromSession；仅 QQ 数字群号场景
 */
export function groupIdFromSession(sessionKey?: string): number | undefined {
  const ref = chatRefFromSession(sessionKey)
  if (!ref || ref.channel !== "qq") return undefined
  const n = Number(ref.chatId)
  return Number.isFinite(n) ? n : undefined
}
