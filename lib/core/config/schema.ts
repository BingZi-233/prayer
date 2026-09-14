import { z } from "zod"
import { CHANNEL_IDS } from "../chat/types"

/** Node 定时器超过此值会退回 1ms，周期必须同时约束上下限。 */
const MAX_TIMER_MS = 2 ** 31 - 1

// 主动回复属于对外发送能力，不能允许 1 秒扫描或无静默窗口这类配置。
// 这些边界同时用于 HTTP 配置、旧库恢复与环境种子，避免仅靠前端自律。
export const PROACTIVE_MIN_SCAN_MS = 10_000
export const PROACTIVE_MIN_SILENCE_MS = 30_000
export const PROACTIVE_MAX_PER_SCAN = 10
export const PROACTIVE_MAX_CANDIDATES_PER_SCAN = 50

/** 兼容旧库的越界数值；错误类型和非有限数仍由 schema 拒绝。 */
function safeInteger(min: number, max = Number.MAX_SAFE_INTEGER) {
  return z.preprocess(
    (value) =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(max, Math.max(min, Math.round(value)))
        : value,
    z.number().int().min(min).max(max)
  )
}

const scanMs = safeInteger(1000, MAX_TIMER_MS)
const durationMs = safeInteger(0)
const proactiveScanMs = safeInteger(PROACTIVE_MIN_SCAN_MS, MAX_TIMER_MS)
const proactiveSilenceMs = safeInteger(PROACTIVE_MIN_SILENCE_MS, MAX_TIMER_MS)
const proactiveCount = safeInteger(1, PROACTIVE_MAX_PER_SCAN)
const proactiveCandidateCount = safeInteger(
  1,
  PROACTIVE_MAX_CANDIDATES_PER_SCAN
)
// 0 明确表示关闭；开启时仍须遵守定时器安全范围。
const optionalScanMs = z.preprocess(
  (value) =>
    typeof value === "number" && Number.isFinite(value) && value <= 0
      ? 0
      : value,
  z.union([z.literal(0), scanMs])
)
const count = safeInteger(1)

export const chatRefSchema = z.object({
  channel: z.enum(CHANNEL_IDS),
  chatId: z.string().trim().min(1),
})

/** 单群未填写的策略跟随全局；负静默时长是输入错误，不自动修正。 */
export const groupPolicySchema = z.object({
  proactiveEnabled: z.boolean().optional(),
  // 群级覆盖是用户主动提交的 API 数据，非法值应拒绝而不是静默改写。
  proactiveSilenceMs: z
    .number()
    .int()
    .min(PROACTIVE_MIN_SILENCE_MS)
    .max(MAX_TIMER_MS)
    .optional(),
  notifyAdminOnHandoff: z.boolean().optional(),
})

const groupPoliciesSchema = z.record(z.string(), groupPolicySchema).default({})

/** 配置字段、默认值与类型的唯一来源；不得引入数据库或运行时依赖。 */
export const appConfigBaseSchema = z.object({
  /** 平台/客服对外显示名称；默认使用 Prayer，可按部署方白标。 */
  brandName: z.string().trim().min(1).max(80).default("Prayer"),
  /** 给 Agent 的简短业务说明；具体事实仍以知识库和插件为准。 */
  brandDescription: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .default("多渠道 AI 客服中台"),
  onebotWsUrl: z.string().default(""),
  onebotAccessToken: z.string().default(""),
  botQQ: z.number().int().nonnegative().default(0),
  /** 群友 @ 这些客服号时也触发机器人。 */
  extraAtQQs: z.array(z.number().int().positive()).default([]),
  /** 管理命令与通知面；null 表示关闭，与 enabledChats 互斥。 */
  adminSurface: chatRefSchema.nullable().default(null),
  handoffTimeoutMin: count.default(30),
  dbPath: z.string().default("./data/agent.db"),
  /** 模型与凭证由此目录中的 settings.json 管理，不进入本配置。 */
  claudeConfigDir: z.string().default("./data/claude-config"),
  enabledChats: z.array(chatRefSchema).default([]),
  telegramBotToken: z.string().default(""),

  reflectScanMs: scanMs.default(300_000),
  reflectLookbackMs: durationMs.default(7_200_000),
  reflectSettleMs: durationMs.default(600_000),
  reflectWindowMax: count.default(60),
  /** 0 关闭自动整理或升格，正数至少 1 秒。 */
  reflectCompactMs: optionalScanMs.default(3_600_000),
  reflectCompactMinEntries: count.default(10),
  reflectPromoteMs: optionalScanMs.default(86_400_000),
  reflectPromoteMinEntries: count.default(1),
  reflectPromoteMaxPerRun: count.default(5),
  reflectNotifyAdmin: z.boolean().default(true),
  /** 会话空闲 TTL；0 关闭过期。 */
  resumeTtlMs: durationMs.default(300_000),
  kbPrefetchEnabled: z.boolean().default(true),
  kbPrefetchTopK: count.default(5),
  /** sqlite-vec L2 距离上限，越大越宽松。 */
  kbPrefetchMaxDistance: z.number().min(0).default(1),

  proactiveEnabled: z.boolean().default(false),
  proactiveScanMs: proactiveScanMs.default(60_000),
  proactiveSilenceMs: proactiveSilenceMs.default(180_000),
  proactiveMaxPerScan: proactiveCount.default(2),
  /** 每轮最多尝试判定/生成的候选数；运行时至少不小于 proactiveMaxPerScan。 */
  proactiveCandidateBudget: proactiveCandidateCount.default(12),
  supportUrl: z.string().default(""),
  ackEnabled: z.boolean().default(true),
  /** 0 不拆分；开启拆分时至少 50 字，避免发送大量碎片消息。 */
  maxReplyChars: z.union([z.literal(0), safeInteger(50)]).default(900),
  topicScanMs: scanMs.default(300_000),
  topicSettleMs: durationMs.default(60_000),
  topicWindowMax: count.default(50),
  topicPromptMax: count.default(40),
  /** USD 日预算；0 不告警。 */
  usageBudgetUsd: z.number().min(0).default(0),
  /** 优先 channel:chatId；读路径兼容历史 QQ 裸群号键。 */
  groupPolicies: groupPoliciesSchema,
})

/**
 * Cross-field invariants belong to the public parser, while patch/restore
 * callers continue to consume the object shape above without a ZodEffects
 * wrapper.  Parsing an old config therefore remains backwards compatible,
 * but the candidate budget can never be lower than the answer cap.
 */
export const appConfigSchema = appConfigBaseSchema.transform((config) => ({
  ...config,
  proactiveCandidateBudget: Math.max(
    config.proactiveMaxPerScan,
    config.proactiveCandidateBudget
  ),
}))

type ParsedAppConfig = z.output<typeof appConfigSchema>
/**
 * 对外保留新增品牌字段的旧调用兼容性：历史测试/集成方可以继续构造旧形状，
 * 但所有经过 schema 的运行时配置都会带上默认值。
 */
export type AppConfig = Omit<
  ParsedAppConfig,
  "brandName" | "brandDescription" | "proactiveCandidateBudget"
> &
  Partial<
    Pick<
      ParsedAppConfig,
      "brandName" | "brandDescription" | "proactiveCandidateBudget"
    >
  >
export type GroupPolicy = z.output<typeof groupPolicySchema>

export function isConfigRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const groupPolicyKeys = [
  "proactiveEnabled",
  "proactiveSilenceMs",
  "notifyAdminOnHandoff",
] as const

// Object records arrive from JSON and may contain prototype-mutating names.
// They are not valid chat policy identifiers; reject them instead of assigning
// into an ordinary object and invoking Object.prototype setters.
const UNSAFE_GROUP_POLICY_KEYS = new Set(["__proto__", "prototype", "constructor"])

export function isSafeGroupPolicyKey(key: string): boolean {
  return !UNSAFE_GROUP_POLICY_KEYS.has(key)
}

/**
 * 旧库容错不能把一条坏群策略扩大成整份 groupPolicies 丢失。
 * HTTP 写入仍走 groupPolicySchema 严格拒绝；这里只对已落盘的历史值做
 * 逐字段保守修复，并把越界的主动回复静默窗口钳到安全下限。
 */
function normalizeStoredGroupPolicy(
  raw: unknown,
  fallback: unknown
): GroupPolicy | undefined {
  const exact = groupPolicySchema.safeParse(raw)
  if (exact.success) return exact.data

  const fallbackParsed = groupPolicySchema.safeParse(fallback)
  if (!isConfigRecord(raw)) {
    return fallbackParsed.success ? fallbackParsed.data : undefined
  }

  const clean: Record<string, unknown> = {}
  for (const key of groupPolicyKeys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue
    const value = raw[key]
    if (key === "proactiveSilenceMs") {
      if (typeof value === "number" && Number.isFinite(value)) {
        clean[key] = Math.min(
          MAX_TIMER_MS,
          Math.max(PROACTIVE_MIN_SILENCE_MS, Math.round(value))
        )
      } else if (
        fallbackParsed.success &&
        fallbackParsed.data.proactiveSilenceMs !== undefined
      ) {
        clean[key] = fallbackParsed.data.proactiveSilenceMs
      }
      continue
    }
    if (typeof value === "boolean") {
      clean[key] = value
    } else if (
      fallbackParsed.success &&
      fallbackParsed.data[key] !== undefined
    ) {
      clean[key] = fallbackParsed.data[key]
    }
  }

  const repaired = groupPolicySchema.safeParse(clean)
  return repaired.success
    ? repaired.data
    : fallbackParsed.success
      ? fallbackParsed.data
      : undefined
}

function normalizeStoredGroupPolicies(
  raw: unknown,
  fallback: unknown
): Record<string, GroupPolicy> {
  const fallbackRecord = isConfigRecord(fallback) ? fallback : {}
  if (!isConfigRecord(raw)) {
    const parsed = groupPoliciesSchema.safeParse(fallback)
    return parsed.success ? parsed.data : {}
  }

  const entries: [string, GroupPolicy][] = []
  for (const [key, value] of Object.entries(raw)) {
    if (!isSafeGroupPolicyKey(key)) continue
    const policy = normalizeStoredGroupPolicy(value, fallbackRecord[key])
    if (policy) entries.push([key, policy])
  }
  return Object.fromEntries(entries)
}

/**
 * 旧库与环境变量按字段恢复：一项损坏只回退该项，保留其余有效配置。
 * HTTP 写入不能用这个容错入口，必须明确拒绝错误类型。
 */
export function normalizeStoredConfig(
  raw: Record<string, unknown>,
  fallback: AppConfig
): AppConfig {
  const fields = Object.entries(appConfigBaseSchema.shape).map(
    ([key, schema]) => {
      if (key === "groupPolicies") {
        return [
          key,
          normalizeStoredGroupPolicies(raw[key], fallback[key]),
        ] as const
      }
      const parsed = schema.safeParse(raw[key])
      const value =
        raw[key] !== undefined && parsed.success
          ? parsed.data
          : fallback[key as keyof AppConfig]
      return [key, value]
    }
  )
  return appConfigSchema.parse(Object.fromEntries(fields))
}
