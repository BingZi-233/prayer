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
  model: string;
  reflectScanMs: number;
  reflectLookbackMs: number;
  reflectSettleMs: number;
  reflectWindowMax: number;
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
    model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    reflectScanMs: Number(env.REFLECT_SCAN_MS ?? "300000"),
    reflectLookbackMs: Number(env.REFLECT_LOOKBACK_MS ?? "7200000"),
    reflectSettleMs: Number(env.REFLECT_SETTLE_MS ?? "600000"),
    reflectWindowMax: Number(env.REFLECT_WINDOW_MAX ?? "60"),
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
