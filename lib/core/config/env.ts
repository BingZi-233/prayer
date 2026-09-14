import type { ChatRef } from "../chat/types"
import {
  appConfigSchema,
  normalizeStoredConfig,
  type AppConfig,
} from "./schema"
import { parseQQList, parseChatIdList, excludeAdminSurface } from "./chats"

function adminSurfaceFromEnv(
  env: Record<string, string | undefined>
): ChatRef | null {
  const gid = Number(env.ADMIN_GROUP_ID ?? "0")
  if (Number.isFinite(gid) && gid > 0) {
    return { channel: "qq", chatId: String(gid) }
  }
  return null
}

function enabledChatsFromEnv(
  env: Record<string, string | undefined>
): ChatRef[] {
  // 历史 env 只有 TELEGRAM_ENABLED_CHATS；QQ 白名单历来只在 UI/库里
  return parseChatIdList(env.TELEGRAM_ENABLED_CHATS).map((chatId) => ({
    channel: "tg" as const,
    chatId,
  }))
}

export function seedFromEnv(
  env: Record<string, string | undefined>
): AppConfig {
  const defaults = appConfigSchema.parse({})
  const num = (key: string, fallback: number) => Number(env[key] ?? fallback)
  const raw = {
    brandName: env.BRAND_NAME ?? defaults.brandName,
    brandDescription: env.BRAND_DESCRIPTION ?? defaults.brandDescription,
    onebotWsUrl: env.ONEBOT_WS_URL ?? defaults.onebotWsUrl,
    onebotAccessToken: env.ONEBOT_ACCESS_TOKEN ?? defaults.onebotAccessToken,
    botQQ: num("BOT_QQ", defaults.botQQ),
    extraAtQQs: parseQQList(env.EXTRA_AT_QQS),
    adminSurface: adminSurfaceFromEnv(env),
    handoffTimeoutMin: num("HANDOFF_TIMEOUT_MIN", defaults.handoffTimeoutMin),
    dbPath: env.DB_PATH ?? defaults.dbPath,
    claudeConfigDir: env.CLAUDE_CONFIG_DIR ?? defaults.claudeConfigDir,
    // 模型不入 AppConfig:由 CLAUDE_CONFIG_DIR/settings.json 的 env.ANTHROPIC_MODEL 决定,
    // 与 BASE_URL/AUTH_TOKEN 同一 env 块,不再显式传给 SDK query。
    reflectScanMs: num("REFLECT_SCAN_MS", defaults.reflectScanMs),
    reflectLookbackMs: num("REFLECT_LOOKBACK_MS", defaults.reflectLookbackMs),
    reflectSettleMs: num("REFLECT_SETTLE_MS", defaults.reflectSettleMs),
    reflectWindowMax: num("REFLECT_WINDOW_MAX", defaults.reflectWindowMax),
    // 默认 1 小时一轮整理(历史默认 24h 太慢,百余条难以及时去重)
    reflectCompactMs: num("REFLECT_COMPACT_MS", defaults.reflectCompactMs),
    reflectCompactMinEntries: num(
      "REFLECT_COMPACT_MIN_ENTRIES",
      defaults.reflectCompactMinEntries
    ),
    reflectPromoteMs: num("REFLECT_PROMOTE_MS", defaults.reflectPromoteMs),
    reflectPromoteMinEntries: num(
      "REFLECT_PROMOTE_MIN_ENTRIES",
      defaults.reflectPromoteMinEntries
    ),
    reflectPromoteMaxPerRun: num(
      "REFLECT_PROMOTE_MAX_PER_RUN",
      defaults.reflectPromoteMaxPerRun
    ),
    // 默认开:env 显式 "false" 才关(与当前始终通知的行为兼容)
    reflectNotifyAdmin: env.REFLECT_NOTIFY_ADMIN !== "false",
    resumeTtlMs: num("RESUME_TTL_MS", defaults.resumeTtlMs),
    // 默认开:env 显式 "false" 才关
    kbPrefetchEnabled: env.KB_PREFETCH_ENABLED !== "false",
    kbPrefetchTopK: num("KB_PREFETCH_TOP_K", defaults.kbPrefetchTopK),
    kbPrefetchMaxDistance: num(
      "KB_PREFETCH_MAX_DISTANCE",
      defaults.kbPrefetchMaxDistance
    ),
    enabledChats: enabledChatsFromEnv(env),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? defaults.telegramBotToken,
    proactiveEnabled: env.PROACTIVE_ENABLED === "true",
    proactiveScanMs: num("PROACTIVE_SCAN_MS", defaults.proactiveScanMs),
    proactiveSilenceMs: num(
      "PROACTIVE_SILENCE_MS",
      defaults.proactiveSilenceMs
    ),
    proactiveMaxPerScan: num(
      "PROACTIVE_MAX_PER_SCAN",
      defaults.proactiveMaxPerScan
    ),
    proactiveCandidateBudget: num(
      "PROACTIVE_CANDIDATE_BUDGET",
      defaults.proactiveCandidateBudget ?? 12
    ),
    supportUrl: env.SUPPORT_URL ?? defaults.supportUrl,
    ackEnabled: env.ACK_ENABLED !== "false",
    maxReplyChars: num("MAX_REPLY_CHARS", defaults.maxReplyChars),
    topicScanMs: num("TOPIC_SCAN_MS", defaults.topicScanMs),
    topicSettleMs: num("TOPIC_SETTLE_MS", defaults.topicSettleMs),
    topicWindowMax: num("TOPIC_WINDOW_MAX", defaults.topicWindowMax),
    topicPromptMax: num("TOPIC_PROMPT_MAX", defaults.topicPromptMax),
    usageBudgetUsd: num("USAGE_BUDGET_USD", defaults.usageBudgetUsd),
    groupPolicies: {},
  }
  const config = normalizeStoredConfig(raw, defaults)
  config.enabledChats = excludeAdminSurface(
    config.enabledChats,
    config.adminSurface
  )
  return config
}
