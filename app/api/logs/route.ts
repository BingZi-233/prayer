import { NextResponse } from "next/server"
import {
  logger,
  MAX_LOG_CONTEXT_CHARS,
  MAX_LOG_MESSAGE_CHARS,
  MAX_LOG_RAW_CHARS,
} from "@/lib/core/logger"
import { ok } from "@/lib/core/api"
import { redactSensitive } from "@/lib/core/log-context"

function bounded(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined
  const redacted = redactSensitive(value)
  return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted
}

// raw 与 msg 相同的条目(captureConsole 捕获的 warn/error 一律 raw=msg)不重复下发:
// 前端只在 raw !== msg 时才展示原文,ring 里 2000 条每次全量回吐,重复字段纯浪费一倍体积
export async function GET(): Promise<NextResponse> {
  const entries = logger
    .tail()
    .map((e) => {
      const msg = bounded(e.msg, MAX_LOG_MESSAGE_CHARS) ?? ""
      const raw = bounded(e.raw, MAX_LOG_RAW_CHARS)
      return {
        ...e,
        scope: bounded(e.scope, MAX_LOG_CONTEXT_CHARS),
        chatId: bounded(e.chatId, MAX_LOG_CONTEXT_CHARS),
        sessionKey: bounded(e.sessionKey, MAX_LOG_CONTEXT_CHARS),
        msg,
        raw: raw !== msg ? raw : undefined,
      }
    })
  return NextResponse.json(ok(entries))
}
