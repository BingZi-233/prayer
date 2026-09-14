import type { AppConfig } from "./config-store"
import { errorMessage, redactSensitive } from "./log-context"
import { maskSecret } from "./settings-writer"

/** 管理 API 可返回的错误摘要上限；详细上下文应留在已脱敏的服务日志中。 */
export const MAX_API_ERROR_CHARS = 300

/** 将 unknown 异常转成可安全返回给管理面的短摘要。 */
export function safeApiError(err: unknown, fallback = "内部错误"): string {
  const text = redactSensitive(errorMessage(err)).trim()
  return (text || fallback).slice(0, MAX_API_ERROR_CHARS)
}

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

export function fail(error: string): { ok: false; error: string } {
  return {
    ok: false,
    error: redactSensitive(error).slice(0, MAX_API_ERROR_CHARS),
  }
}

export function maskConfig(cfg: AppConfig): AppConfig {
  return {
    ...cfg,
    onebotAccessToken: maskSecret(cfg.onebotAccessToken),
    telegramBotToken: maskSecret(cfg.telegramBotToken),
  }
}
