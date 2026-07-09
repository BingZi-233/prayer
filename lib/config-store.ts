import type { Repo } from "./db/repo";

const KEY = "app";

export interface AppConfig {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
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
}

function seedFromEnv(env: Record<string, string | undefined>): AppConfig {
  return {
    onebotWsUrl: env.ONEBOT_WS_URL ?? "",
    onebotAccessToken: env.ONEBOT_ACCESS_TOKEN ?? "",
    botQQ: Number(env.BOT_QQ ?? "0"),
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
