import { z } from "zod"
import { CHANNEL_IDS } from "../chat/types"

/** Node 定时器超过此值会退回 1ms，周期必须同时约束上下限。 */
const MAX_TIMER_MS = 2 ** 31 - 1

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
  proactiveSilenceMs: z.number().int().min(0).optional(),
  notifyAdminOnHandoff: z.boolean().optional(),
})

/** 配置字段、默认值与类型的唯一来源；不得引入数据库或运行时依赖。 */
export const appConfigSchema = z.object({
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
  proactiveScanMs: scanMs.default(60_000),
  proactiveSilenceMs: durationMs.default(180_000),
  proactiveMaxPerScan: count.default(2),
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
  groupPolicies: z.record(z.string(), groupPolicySchema).default({}),
})

type ParsedAppConfig = z.output<typeof appConfigSchema>
/**
 * 对外保留新增品牌字段的旧调用兼容性：历史测试/集成方可以继续构造旧形状，
 * 但所有经过 schema 的运行时配置都会带上默认值。
 */
export type AppConfig = Omit<
  ParsedAppConfig,
  "brandName" | "brandDescription"
> &
  Partial<Pick<ParsedAppConfig, "brandName" | "brandDescription">>
export type GroupPolicy = z.output<typeof groupPolicySchema>

export function isConfigRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 旧库与环境变量按字段恢复：一项损坏只回退该项，保留其余有效配置。
 * HTTP 写入不能用这个容错入口，必须明确拒绝错误类型。
 */
export function normalizeStoredConfig(
  raw: Record<string, unknown>,
  fallback: AppConfig
): AppConfig {
  const fields = Object.entries(appConfigSchema.shape).map(([key, schema]) => {
    const parsed = schema.safeParse(raw[key])
    const value =
      raw[key] !== undefined && parsed.success
        ? parsed.data
        : fallback[key as keyof AppConfig]
    return [key, value]
  })
  return appConfigSchema.parse(Object.fromEntries(fields))
}
