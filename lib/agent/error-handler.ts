import { bus } from "../bus"
import type { ErrorOccurred } from "../events"
import type { ChannelId } from "../channels/types"
import {
  legacySessionKeyToCanonical,
  parseSessionKey,
} from "../channels/ids"
import { logger } from "../logger"
import {
  classifyError,
  errorMessage,
  groupIdFromSession,
} from "../log-classify"

export interface ErrorHandlerDeps {
  /** 自定义记录;缺省走结构化 logger.error(不经 console,避免 ring 双记) */
  logger?: (scope: string, err: unknown) => void
  /** 兜底文案;缺省引导「人工」+ 支持链接 */
  fallbackText?: string
  supportUrl?: string
}

export function defaultFallbackText(supportUrl?: string): string {
  const link = supportUrl ? ` 也可访问 ${supportUrl} 查看官网说明。` : ""
  return `系统繁忙,请稍后再试,或回复「人工」转接客服。${link}`.trim()
}

// 再导出,兼容旧测试/调用方
export {
  errorMessage,
  classifyError as explainErrorClassify,
} from "../log-classify"

/** 从事件解析 channel + chatId(优先字段,否则 sessionKey) */
function resolveTarget(e: {
  channel?: ChannelId
  chatId?: string
  sessionKey?: string
  groupId?: number
}): { channel?: ChannelId; chatId?: string; groupId?: number } {
  if (e.channel && e.chatId) {
    const groupId =
      e.channel === "qq" && Number.isFinite(Number(e.chatId))
        ? Number(e.chatId)
        : e.groupId
    return { channel: e.channel, chatId: e.chatId, groupId }
  }
  if (e.sessionKey) {
    const parsed = parseSessionKey(legacySessionKeyToCanonical(e.sessionKey))
    if (parsed) {
      const groupId =
        parsed.channel === "qq" && Number.isFinite(Number(parsed.chatId))
          ? Number(parsed.chatId)
          : undefined
      return {
        channel: parsed.channel,
        chatId: parsed.chatId,
        groupId,
      }
    }
  }
  if (e.groupId != null) {
    return {
      channel: "qq",
      chatId: String(e.groupId),
      groupId: e.groupId,
    }
  }
  return { groupId: e.groupId }
}

/** @deprecated 用 classifyError;保留薄包装兼容旧测试 */
export function explainError(msg: string): string {
  const c = classifyError(msg)
  if (c.code === "unknown") return msg
  return `【${c.title}】${c.hint} | 原始: ${msg}`
}

/** @deprecated 结构化日志后由 logger 负责格式;保留兼容旧测试 */
export function formatErrorLine(e: {
  scope: string
  err: unknown
  sessionKey?: string
  groupId?: number
  channel?: ChannelId
  chatId?: string
}): string {
  const raw = errorMessage(e.err)
  const c = classifyError(raw)
  const { groupId, chatId, channel } = resolveTarget(e)
  const gid = groupId ?? groupIdFromSession(e.sessionKey)
  const ctx: string[] = []
  if (gid != null) ctx.push(`群=${gid}`)
  else if (channel && chatId) ctx.push(`${channel}:${chatId}`)
  if (e.sessionKey) ctx.push(`session=${e.sessionKey}`)
  const head = ctx.length
    ? `[${e.scope}] (${ctx.join(" ")})`
    : `[${e.scope}]`
  if (c.code === "unknown") return `${head} ${raw}`
  return `${head} 【${c.title}】${c.hint} | 原始: ${raw}`
}

function defaultLogError(scope: string, err: unknown, e: ErrorOccurred): void {
  const raw = errorMessage(err)
  const c = classifyError(raw)
  const { groupId } = resolveTarget(e)
  // unknown:msg 用 raw 首行,避免 ring/stdout 只剩「未分类错误」;已分类用 title
  const msg =
    c.code === "unknown" ? raw.split("\n")[0].slice(0, 300) : c.title
  logger.error(msg, {
    scope,
    groupId,
    sessionKey: e.sessionKey,
    code: c.code,
    category: c.category,
    title: c.title,
    hint: c.hint,
    retryable: c.retryable,
    raw,
    skipClassify: true,
  })
}

/** 是否应向用户发兜底话术 */
function shouldUserReply(e: ErrorOccurred): boolean {
  if (e.userVisible === false) return false
  if (e.scope === "intent") return false
  // channel.send* 发送失败再回用户会连环炸
  if (e.scope.startsWith("channel.send")) return false
  return true
}

export function registerErrorHandler(deps: ErrorHandlerDeps = {}): () => void {
  const text = deps.fallbackText ?? defaultFallbackText(deps.supportUrl)

  const onError = (e: ErrorOccurred) => {
    if (deps.logger) {
      // 自定义 logger 仍给整行人话,便于单测 spy
      deps.logger(e.scope, formatErrorLine(e))
    } else {
      defaultLogError(e.scope, e.err, e)
    }
    if (!shouldUserReply(e)) return

    const { channel, chatId } = resolveTarget(e)
    if (channel && chatId) {
      bus.emit("action.send", { channel, chatId, text })
    }
  }

  bus.on("error.occurred", onError)
  return () => bus.off("error.occurred", onError)
}
