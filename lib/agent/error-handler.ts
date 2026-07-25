import { bus } from "../bus"
import type { ErrorOccurred } from "../events"
import type { ChannelId } from "../channels/types"
import { legacySessionKeyToCanonical, parseSessionKey } from "../channels/ids"
import { logger } from "../logger"
import { errorMessage, chatRefFromSession } from "../log-context"

export interface ErrorHandlerDeps {
  /** 自定义记录;缺省走结构化 logger.error(不经 console,避免 ring 双记) */
  logger?: (scope: string, err: unknown) => void
  /** 兜底文案;缺省引导「人工」+ 支持链接 */
  fallbackText?: string
  supportUrl?: string
}

export function defaultFallbackText(supportUrl?: string): string {
  const link = supportUrl ? ` 也可访问 ${supportUrl} 查看官网说明。` : ""
  return `系统繁忙,请稍后再试,或 @我 后回复「人工」转接客服。${link}`.trim()
}

// 再导出,兼容旧测试/调用方
export { errorMessage } from "../log-context"

/** 从事件解析 channel + chatId(优先字段,否则 sessionKey) */
function resolveTarget(e: {
  channel?: ChannelId
  chatId?: string
  sessionKey?: string
}): { channel?: ChannelId; chatId?: string } {
  if (e.channel && e.chatId) {
    return { channel: e.channel, chatId: e.chatId }
  }
  if (e.sessionKey) {
    const parsed = parseSessionKey(legacySessionKeyToCanonical(e.sessionKey))
    if (parsed) {
      return { channel: parsed.channel, chatId: parsed.chatId }
    }
    const fromLog = chatRefFromSession(e.sessionKey)
    if (fromLog) return fromLog
  }
  return {}
}

/** 拼一行带上下文的错误文案(deps.logger 分支与旧测试用) */
export function formatErrorLine(e: {
  scope: string
  err: unknown
  sessionKey?: string
  channel?: ChannelId
  chatId?: string
}): string {
  const raw = errorMessage(e.err)
  const { chatId, channel } = resolveTarget(e)
  const ctx: string[] = []
  if (channel && chatId) ctx.push(`${channel}:${chatId}`)
  if (e.sessionKey) ctx.push(`session=${e.sessionKey}`)
  const head = ctx.length ? `[${e.scope}] (${ctx.join(" ")})` : `[${e.scope}]`
  return `${head} ${raw}`
}

function defaultLogError(scope: string, err: unknown, e: ErrorOccurred): void {
  const raw = errorMessage(err)
  const { channel, chatId } = resolveTarget(e)
  // 摘要取原文首行,完整原文(含 stack)放 raw,后台展开可看
  logger.error(raw.split("\n")[0].slice(0, 300), {
    scope,
    channel,
    chatId,
    sessionKey: e.sessionKey,
    raw,
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
