export interface AppConfig {
  onebotWsUrl: string;
  onebotAccessToken?: string;
  botQQ: number;
  adminGroupId: number;
  handoffTimeoutMin: number;
  model: string;
  dbPath: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const required = ["ONEBOT_WS_URL", "BOT_QQ", "ADMIN_GROUP_ID"];
  for (const k of required) {
    if (!env[k]) throw new Error(`缺少必填环境变量: ${k}`);
  }
  return {
    onebotWsUrl: env.ONEBOT_WS_URL!,
    onebotAccessToken: env.ONEBOT_ACCESS_TOKEN,
    botQQ: Number(env.BOT_QQ),
    adminGroupId: Number(env.ADMIN_GROUP_ID),
    handoffTimeoutMin: Number(env.HANDOFF_TIMEOUT_MIN ?? "30"),
    model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    dbPath: env.DB_PATH ?? "./data/agent.db",
  };
}
