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
  return JSON.parse(raw) as AppConfig;
}

export function setConfig(repo: Repo, patch: Partial<AppConfig>): AppConfig {
  const current = getConfig(repo);
  const next = { ...current, ...patch };
  repo.setConfigRow(KEY, JSON.stringify(next));
  return next;
}
