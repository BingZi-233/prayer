import type { Repo } from "./db/repo";

const KEY = "app";

/** 单群策略覆盖(未写字段回退全局配置) */
export interface GroupPolicy {
  /** 覆盖全局 proactiveEnabled;undefined = 跟全局 */
  proactiveEnabled?: boolean;
  /** 覆盖全局 proactiveSilenceMs */
  proactiveSilenceMs?: number;
  /** 转人工时是否抄送管理群;默认 true */
  notifyAdminOnHandoff?: boolean;
}

export interface AppConfig {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
  /**
   * 额外监听的 QQ:群友 @ 这些人时也当作 @bot 处理。
   * 常用于群管理/客服号被误当 bot 的场景。默认 []。
   */
  extraAtQQs: number[];
  adminGroupId: number;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  reflectScanMs: number;
  reflectLookbackMs: number;
  reflectSettleMs: number;
  reflectWindowMax: number;
  reflectCompactMs: number;
  reflectCompactMinEntries: number;
  // 反思沉淀/整理后是否向管理群发通知。默认开(保持既有行为);设 false 静默沉淀
  reflectNotifyAdmin: boolean;
  // 会话空闲 TTL:超时后不 resume,下条消息开全新对话。默认 5 分钟
  resumeTtlMs: number;
  enabledGroups: number[];
  proactiveEnabled: boolean;
  proactiveScanMs: number;
  proactiveSilenceMs: number;
  proactiveMaxPerScan: number;
  /** 办不了事务时引导的固定链接(官网) */
  supportUrl: string;
  /** @ 后是否先发「收到,正在查」ACK。默认开 */
  ackEnabled: boolean;
  /** 单条回复字数上限,超出则拆条;0 = 不拆。默认 900 */
  maxReplyChars: number;
  /** 用量日预算(USD),超阈告警管理群;0 = 不告警 */
  usageBudgetUsd: number;
  /** 按群策略覆盖,key 为群号字符串 */
  groupPolicies: Record<string, GroupPolicy>;
}

/** 解析逗号/空白分隔的 QQ 列表,过滤非法项并去重 */
export function parseQQList(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const n = Number(part);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function seedFromEnv(env: Record<string, string | undefined>): AppConfig {
  return {
    onebotWsUrl: env.ONEBOT_WS_URL ?? "",
    onebotAccessToken: env.ONEBOT_ACCESS_TOKEN ?? "",
    botQQ: Number(env.BOT_QQ ?? "0"),
    extraAtQQs: parseQQList(env.EXTRA_AT_QQS),
    adminGroupId: Number(env.ADMIN_GROUP_ID ?? "0"),
    handoffTimeoutMin: Number(env.HANDOFF_TIMEOUT_MIN ?? "30"),
    dbPath: env.DB_PATH ?? "./data/agent.db",
    claudeConfigDir: env.CLAUDE_CONFIG_DIR ?? "./data/claude-config",
    // 模型不入 AppConfig:由 CLAUDE_CONFIG_DIR/settings.json 的 env.ANTHROPIC_MODEL 决定,
    // 与 BASE_URL/AUTH_TOKEN 同一 env 块,不再显式传给 SDK query。
    reflectScanMs: Number(env.REFLECT_SCAN_MS ?? "300000"),
    reflectLookbackMs: Number(env.REFLECT_LOOKBACK_MS ?? "7200000"),
    reflectSettleMs: Number(env.REFLECT_SETTLE_MS ?? "600000"),
    reflectWindowMax: Number(env.REFLECT_WINDOW_MAX ?? "60"),
    reflectCompactMs: Number(env.REFLECT_COMPACT_MS ?? "86400000"),
    reflectCompactMinEntries: Number(env.REFLECT_COMPACT_MIN_ENTRIES ?? "10"),
    // 默认开:env 显式 "false" 才关(与当前始终通知的行为兼容)
    reflectNotifyAdmin: env.REFLECT_NOTIFY_ADMIN !== "false",
    resumeTtlMs: Number(env.RESUME_TTL_MS ?? "300000"),
    enabledGroups: [],
    proactiveEnabled: env.PROACTIVE_ENABLED === "true",
    proactiveScanMs: Number(env.PROACTIVE_SCAN_MS ?? "60000"),
    proactiveSilenceMs: Number(env.PROACTIVE_SILENCE_MS ?? "180000"),
    proactiveMaxPerScan: Number(env.PROACTIVE_MAX_PER_SCAN ?? "2"),
    supportUrl: env.SUPPORT_URL ?? "https://www.packyapi.com",
    ackEnabled: env.ACK_ENABLED !== "false",
    maxReplyChars: Number(env.MAX_REPLY_CHARS ?? "900"),
    usageBudgetUsd: Number(env.USAGE_BUDGET_USD ?? "0"),
    groupPolicies: {},
  };
}

export function getConfig(
  repo: Repo,
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const raw = repo.getConfigRow(KEY);
  if (!raw) {
    const seeded = seedFromEnv(env);
    repo.setConfigRow(KEY, JSON.stringify(seeded));
    return seeded;
  }
  // 与默认值合并:日后给 AppConfig 加字段时,旧库缺失字段自动补默认(存储值优先)
  return { ...seedFromEnv(env), ...(JSON.parse(raw) as Partial<AppConfig>) };
}

export function setConfig(repo: Repo, patch: Partial<AppConfig>): AppConfig {
  const current = getConfig(repo);
  const next = { ...current, ...patch };
  repo.setConfigRow(KEY, JSON.stringify(next));
  return next;
}

/** 解析某群是否启用主动补位(群策略覆盖全局) */
export function isProactiveEnabledForGroup(cfg: AppConfig, groupId: number): boolean {
  const p = cfg.groupPolicies[String(groupId)];
  if (p?.proactiveEnabled !== undefined) return p.proactiveEnabled;
  return cfg.proactiveEnabled;
}

/** 解析某群静默阈值 */
export function silenceMsForGroup(cfg: AppConfig, groupId: number): number {
  const p = cfg.groupPolicies[String(groupId)];
  if (p?.proactiveSilenceMs !== undefined) return p.proactiveSilenceMs;
  return cfg.proactiveSilenceMs;
}
