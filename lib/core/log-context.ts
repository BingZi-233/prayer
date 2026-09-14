/** 运行日志的上下文工具:错误文案抽取 + 从 sessionKey 反解 chat-ref */

import type { ChannelId } from "./chat/types"

/** 从 unknown 抽出错误文案 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/**
 * 去掉日志/指标中常见的凭据和带签名 URL 参数。
 * 入站原文仍保留在受权限保护的会话存储中；只有进入运维输出的副本做脱敏，
 * 避免 provider 错误、图片下载错误或工具输入把 token 带进 PM2/ring 日志。
 */
export function redactSensitive(text: string): string {
  return (
    text
      .replace(/\b(sk-(?:ant-)?)[A-Za-z0-9_-]{8,}\b/g, "$1[REDACTED]")
      .replace(/(\b(?:Bearer|Basic)\s+)[^\s,;]+/gi, "$1[REDACTED]")
      // 常见 JSON / key=value 错误文案；只替换值，尽量保留原始日志结构。
      .replace(
        /((?:["']?(?:access[_-]?token|auth(?:orization|[_-]?token)?|anthropic[_-]?auth[_-]?token|api[_-]?key|bot[_-]?token|client[_-]?secret|private[_-]?key|password|refresh[_-]?token|secret|session[_-]?token|token)["']?\s*[:=]\s*["']?))(?!Bearer\b|Basic\b)[^"'\s,}&?#]+/gi,
        "$1[REDACTED]"
      )
      // Telegram bot token 形如数字:长随机串，通常不会带 key 名。
      .replace(/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
      .replace(
        /([?&](?:token|access_token|auth|authorization|api[_-]?key|key|secret|signature|sig|password)=)[^&#\s]+/gi,
        "$1[REDACTED]"
      )
  )
}

/** 运维/投递错误落库上限；避免凭据和异常长响应长期驻留。 */
export const MAX_DIAGNOSTIC_CHARS = 300

export function redactDiagnostic(text: string): string {
  return redactSensitive(text).slice(0, MAX_DIAGNOSTIC_CHARS)
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
