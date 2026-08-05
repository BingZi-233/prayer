import type { Repo } from "./db/repo"
import type { ChannelId, ChatRef } from "./channels/types"

const KEY = "app"

/** 单群策略覆盖(未写字段回退全局配置) */
export interface GroupPolicy {
  /** 覆盖全局 proactiveEnabled;undefined = 跟全局 */
  proactiveEnabled?: boolean
  /** 覆盖全局 proactiveSilenceMs */
  proactiveSilenceMs?: number
  /** 转人工时是否抄送管理群;默认 true */
  notifyAdminOnHandoff?: boolean
}

export interface AppConfig {
  onebotWsUrl: string
  onebotAccessToken: string
  botQQ: number
  /**
   * 额外监听的 QQ:群友 @ 这些人时也当作 @bot 处理。
   * 常用于群管理/客服号被误当 bot 的场景。默认 []。
   */
  extraAtQQs: number[]
  /**
   * 管理命令 + 转人工/反思通知面。
   * null = 无管理面（不通知、无管理命令）。
   */
  adminSurface: ChatRef | null
  handoffTimeoutMin: number
  dbPath: string
  claudeConfigDir: string
  reflectScanMs: number
  reflectLookbackMs: number
  reflectSettleMs: number
  reflectWindowMax: number
  reflectCompactMs: number
  reflectCompactMinEntries: number
  // 自动升格评审周期(ms)。默认每日;≤0 关闭
  reflectPromoteMs: number
  // 候选至少 N 条才调 LLM。默认 1
  reflectPromoteMinEntries: number
  // 单轮最多升格条数。默认 5
  reflectPromoteMaxPerRun: number
  // 反思沉淀/整理后是否向管理群发通知。默认开(保持既有行为);设 false 静默沉淀
  reflectNotifyAdmin: boolean
  // 会话空闲 TTL:超时后不 resume,下条消息开全新对话。默认 5 分钟
  resumeTtlMs: number
  /** 生效会话白名单（跨通道 chat-ref） */
  enabledChats: ChatRef[]
  /** Telegram Bot API token；空 = 未配置 */
  telegramBotToken: string
  proactiveEnabled: boolean
  proactiveScanMs: number
  proactiveSilenceMs: number
  proactiveMaxPerScan: number
  /** 办不了事务时引导的固定链接(官网) */
  supportUrl: string
  /** @ 后是否先发「收到,正在查」ACK。默认开 */
  ackEnabled: boolean
  /** 单条回复字数上限,超出则拆条;0 = 不拆。默认 900 */
  maxReplyChars: number
  /** 问题排行归类扫描周期(ms)。默认 5 分钟 */
  topicScanMs: number
  /** 归类静置窗(ms):只处理早于 now-该值的提问。默认 1 分钟 */
  topicSettleMs: number
  /** 每群每轮最多归类条数。默认 50 */
  topicWindowMax: number
  /** 喂 LLM 的现有主题上限。默认 40 */
  topicPromptMax: number
  /** 用量日预算(USD),超阈告警管理群;0 = 不告警 */
  usageBudgetUsd: number
  /**
   * 按会话策略覆盖。
   * key 优先 `channel:chatId`；QQ 历史裸群号键仍可由 getGroupPolicy 回退读取。
   */
  groupPolicies: Record<string, GroupPolicy>
}

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

const CHANNEL_IDS = new Set<string>(["qq", "tg", "discord"])

function isChannelId(v: unknown): v is ChannelId {
  return typeof v === "string" && CHANNEL_IDS.has(v)
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

function seedFromEnv(env: Record<string, string | undefined>): AppConfig {
  return {
    onebotWsUrl: env.ONEBOT_WS_URL ?? "",
    onebotAccessToken: env.ONEBOT_ACCESS_TOKEN ?? "",
    botQQ: Number(env.BOT_QQ ?? "0"),
    extraAtQQs: parseQQList(env.EXTRA_AT_QQS),
    adminSurface: adminSurfaceFromEnv(env),
    handoffTimeoutMin: Number(env.HANDOFF_TIMEOUT_MIN ?? "30"),
    dbPath: env.DB_PATH ?? "./data/agent.db",
    claudeConfigDir: env.CLAUDE_CONFIG_DIR ?? "./data/claude-config",
    // 模型不入 AppConfig:由 CLAUDE_CONFIG_DIR/settings.json 的 env.ANTHROPIC_MODEL 决定,
    // 与 BASE_URL/AUTH_TOKEN 同一 env 块,不再显式传给 SDK query。
    reflectScanMs: Number(env.REFLECT_SCAN_MS ?? "300000"),
    reflectLookbackMs: Number(env.REFLECT_LOOKBACK_MS ?? "7200000"),
    reflectSettleMs: Number(env.REFLECT_SETTLE_MS ?? "600000"),
    reflectWindowMax: Number(env.REFLECT_WINDOW_MAX ?? "60"),
    // 默认 1 小时一轮整理(历史默认 24h 太慢,百余条难以及时去重)
    reflectCompactMs: Number(env.REFLECT_COMPACT_MS ?? "3600000"),
    reflectCompactMinEntries: Number(env.REFLECT_COMPACT_MIN_ENTRIES ?? "10"),
    reflectPromoteMs: Number(env.REFLECT_PROMOTE_MS ?? "86400000"),
    reflectPromoteMinEntries: Number(env.REFLECT_PROMOTE_MIN_ENTRIES ?? "1"),
    reflectPromoteMaxPerRun: Number(env.REFLECT_PROMOTE_MAX_PER_RUN ?? "5"),
    // 默认开:env 显式 "false" 才关(与当前始终通知的行为兼容)
    reflectNotifyAdmin: env.REFLECT_NOTIFY_ADMIN !== "false",
    resumeTtlMs: Number(env.RESUME_TTL_MS ?? "300000"),
    enabledChats: enabledChatsFromEnv(env),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? "",
    proactiveEnabled: env.PROACTIVE_ENABLED === "true",
    proactiveScanMs: Number(env.PROACTIVE_SCAN_MS ?? "60000"),
    proactiveSilenceMs: Number(env.PROACTIVE_SILENCE_MS ?? "180000"),
    proactiveMaxPerScan: Number(env.PROACTIVE_MAX_PER_SCAN ?? "2"),
    supportUrl: env.SUPPORT_URL ?? "https://www.packyapi.ai",
    ackEnabled: env.ACK_ENABLED !== "false",
    maxReplyChars: Number(env.MAX_REPLY_CHARS ?? "900"),
    topicScanMs: Number(env.TOPIC_SCAN_MS ?? "300000"),
    topicSettleMs: Number(env.TOPIC_SETTLE_MS ?? "60000"),
    topicWindowMax: Number(env.TOPIC_WINDOW_MAX ?? "50"),
    topicPromptMax: Number(env.TOPIC_PROMPT_MAX ?? "40"),
    usageBudgetUsd: Number(env.USAGE_BUDGET_USD ?? "0"),
    groupPolicies: {},
  }
}

/** 磁盘 JSON 上可能残留的 legacy 字段（读路径 migrate 用，不进 AppConfig） */
type LegacyRaw = {
  adminGroupId?: unknown
  enabledGroups?: unknown
  telegramEnabledChats?: unknown
  adminSurface?: unknown
  enabledChats?: unknown
}

/**
 * 一次性迁移：legacy 双字段 → enabledChats / adminSurface，并剥掉旧键。
 * 返回是否需要写回磁盘。
 */
export function migrateConfigShape(
  raw: Record<string, unknown>,
  seed: AppConfig
): { cfg: AppConfig; migrated: boolean } {
  const legacy = raw as LegacyRaw
  let migrated = false

  let enabledChats: ChatRef[]
  if (Array.isArray(legacy.enabledChats)) {
    enabledChats = normalizeChatRefs(legacy.enabledChats)
  } else {
    const groups = Array.isArray(legacy.enabledGroups)
      ? (legacy.enabledGroups as unknown[])
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0)
      : []
    const tg = Array.isArray(legacy.telegramEnabledChats)
      ? (legacy.telegramEnabledChats as unknown[]).map(String)
      : []
    enabledChats = enabledChatsFromLegacy(groups, tg)
    // 仅当确有 legacy 键时才算迁移（避免空库每次写回）
    if ("enabledGroups" in raw || "telegramEnabledChats" in raw) {
      migrated = true
    }
  }

  let adminSurface: ChatRef | null
  if ("adminSurface" in raw) {
    adminSurface = normalizeAdminSurface(legacy.adminSurface)
  } else if ("adminGroupId" in raw) {
    const gid = Number(legacy.adminGroupId)
    adminSurface =
      Number.isFinite(gid) && gid > 0
        ? { channel: "qq", chatId: String(gid) }
        : null
    migrated = true
  } else {
    adminSurface = seed.adminSurface
  }

  // 剥掉 legacy 键 + 用规范化后的 SOT 覆盖
  const rest = { ...raw } as Record<string, unknown>
  if ("adminGroupId" in rest) {
    delete rest.adminGroupId
    migrated = true
  }
  if ("enabledGroups" in rest) {
    delete rest.enabledGroups
    migrated = true
  }
  if ("telegramEnabledChats" in rest) {
    delete rest.telegramEnabledChats
    migrated = true
  }

  const merged: AppConfig = {
    ...seed,
    ...(rest as Partial<AppConfig>),
    enabledChats,
    adminSurface,
  }
  // 再规范化一次，防止 rest 里脏 chat-ref
  merged.enabledChats = normalizeChatRefs(merged.enabledChats)
  merged.adminSurface = normalizeAdminSurface(merged.adminSurface)
  // 管理群若残留在白名单里 → 剔除并写回
  const withoutAdmin = excludeAdminSurface(
    merged.enabledChats,
    merged.adminSurface
  )
  if (withoutAdmin.length !== merged.enabledChats.length) {
    merged.enabledChats = withoutAdmin
    migrated = true
  }

  return { cfg: merged, migrated }
}

export function getConfig(
  repo: Repo,
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const seed = seedFromEnv(env)
  const raw = repo.getConfigRow(KEY)
  if (!raw) {
    repo.setConfigRow(KEY, JSON.stringify(seed))
    return seed
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    repo.setConfigRow(KEY, JSON.stringify(seed))
    return seed
  }
  const { cfg, migrated } = migrateConfigShape(parsed, seed)
  if (migrated) {
    repo.setConfigRow(KEY, JSON.stringify(cfg))
  }
  return cfg
}

export function setConfig(repo: Repo, patch: Partial<AppConfig>): AppConfig {
  const current = getConfig(repo)
  const next: AppConfig = { ...current, ...patch }
  // 规范化 SOT 字段，避免脏数据落库
  if (patch.enabledChats !== undefined) {
    next.enabledChats = normalizeChatRefs(patch.enabledChats)
  }
  if (patch.adminSurface !== undefined) {
    next.adminSurface = normalizeAdminSurface(patch.adminSurface)
  }
  // 互斥不变式:管理群永不出现在生效会话里(改哪一侧都重算)
  next.enabledChats = excludeAdminSurface(next.enabledChats, next.adminSurface)
  repo.setConfigRow(KEY, JSON.stringify(next))
  return next
}

/** 解析某群是否启用主动补位(群策略覆盖全局；QQ 群号) */
export function isProactiveEnabledForGroup(
  cfg: AppConfig,
  groupId: number
): boolean {
  const p =
    cfg.groupPolicies[`qq:${groupId}`] ?? cfg.groupPolicies[String(groupId)]
  if (p?.proactiveEnabled !== undefined) return p.proactiveEnabled
  return cfg.proactiveEnabled
}

/** 解析某群静默阈值 */
export function silenceMsForGroup(cfg: AppConfig, groupId: number): number {
  const p =
    cfg.groupPolicies[`qq:${groupId}`] ?? cfg.groupPolicies[String(groupId)]
  if (p?.proactiveSilenceMs !== undefined) return p.proactiveSilenceMs
  return cfg.proactiveSilenceMs
}
