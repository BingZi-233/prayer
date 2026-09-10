import type { ChannelId } from "../channels/types"

export type LogLevel = "info" | "warn" | "error"

/**
 * 结构化日志条目(ring buffer + 管理后台)。
 * 纯时间线:每次写入都是一条独立记录,不做去重合并、不做错误分类。
 */
export interface LogEntry {
  ts: number
  level: LogLevel
  /** 列表默认展示的人话摘要 */
  msg: string
  scope?: string
  /** 通道 + 会话 id（chat-ref）；新写入优先 */
  channel?: ChannelId
  chatId?: string
  /**
   * @deprecated 用 channel+chatId；仅旧 ring / 回读兼容
   */
  groupId?: number
  sessionKey?: string
  /** 上游原文(含多行 stack),后台展开时展示 */
  raw?: string
}

/** @deprecated 用 LogEntry;保留别名兼容旧 import */
export type LogLine = LogEntry

export interface LogMeta {
  scope?: string
  channel?: ChannelId
  chatId?: string
  /** @deprecated 用 channel+chatId */
  groupId?: number
  sessionKey?: string
  raw?: string
}

const MAX = 2000

/** 会话标识：优先 channel:chatId，回退旧 groupId */
function chatIdentity(
  e: Pick<LogEntry, "channel" | "chatId" | "groupId">
): string {
  if (e.channel && e.chatId) return `${e.channel}:${e.chatId}`
  if (e.groupId != null) return `qq:${e.groupId}`
  return ""
}

/** 供单测/导出:格式化一行 stdout */
export function consoleLine(e: LogEntry): string {
  const bits: string[] = []
  if (e.scope) bits.push(`[${e.scope}]`)
  const chat = chatIdentity(e)
  if (chat) bits.push(`会话=${chat}`)
  const head = bits.length ? bits.join(" ") + " " : ""
  // 优先 raw 首行(含上游原始文案),回退 msg
  const first = (e.raw ?? e.msg ?? "").split("\n")[0].slice(0, 300)
  return `${head}${first}`
}

class RingLogger {
  private buf: LogEntry[] = []
  /** captureConsole 前保存的原始 console,emit 时写 pm2 不回环 */
  private origConsole: {
    log: (...a: unknown[]) => void
    warn: (...a: unknown[]) => void
    error: (...a: unknown[]) => void
  } | null = null

  setOrigConsole(c: RingLogger["origConsole"] | null): void {
    this.origConsole = c
  }

  /** 兼容旧 API:纯字符串日志 */
  log(level: LogLevel, msg: string): void {
    this.emit({ level, msg })
  }

  info(msg: string, meta?: LogMeta): void {
    this.emit({ level: "info", msg, ...meta })
  }

  warn(msg: string, meta?: LogMeta): void {
    this.emit({ level: "warn", msg, ...meta })
  }

  error(msg: string, meta?: LogMeta): void {
    this.emit({ level: "error", msg, ...meta })
  }

  /** 写入一条日志;始终 append,返回该条目 */
  emit(
    partial: { level: LogLevel; msg: string } & Partial<LogEntry> & LogMeta
  ): LogEntry {
    const entry: LogEntry = {
      ts: Date.now(),
      level: partial.level,
      msg: partial.msg,
      scope: partial.scope,
      channel: partial.channel,
      chatId: partial.chatId,
      groupId: partial.groupId,
      sessionKey: partial.sessionKey,
      raw: partial.raw,
    }
    this.buf.push(entry)
    if (this.buf.length > MAX) this.buf.splice(0, this.buf.length - MAX)
    this.writeStdout(entry)
    return entry
  }

  private writeStdout(e: LogEntry): void {
    const line = consoleLine(e)
    const o = this.origConsole
    if (!o) return // 未 patch 前不写,避免与调用方 console 重复
    if (e.level === "error") o.error(line)
    else if (e.level === "warn") o.warn(line)
    else o.log(line)
  }

  tail(): LogEntry[] {
    return this.buf.map((e) => ({ ...e }))
  }

  clear(): void {
    this.buf = []
  }
}

const g = globalThis as unknown as {
  __agentLogger?: RingLogger
  __consolePatched?: boolean
}
export const logger: RingLogger =
  g.__agentLogger ?? (g.__agentLogger = new RingLogger())

// 一次性捕获 console 输出到 ring buffer(SDK/agent 的日志也进来)
export function captureConsole(): void {
  if (g.__consolePatched) return
  g.__consolePatched = true

  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }
  logger.setOrigConsole(orig)

  const fmt = (a: unknown): string => {
    if (typeof a === "string") return a
    if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`
    try {
      return JSON.stringify(a)
    } catch {
      return String(a)
    }
  }

  const wrap = (level: LogLevel) => {
    return (...args: unknown[]) => {
      const msg = args.map(fmt).join(" ")
      // 直接 emit 进 ring;stdout 由 emit→writeStdout 打一次,避免双份
      logger.emit({
        level,
        msg,
        raw: level === "error" || level === "warn" ? msg : undefined,
      })
    }
  }

  console.log = wrap("info")
  console.warn = wrap("warn")
  console.error = wrap("error")
}
