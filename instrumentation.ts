export async function register(): Promise<void> {
  // 仅 Node runtime 执行(跳过 edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadConfig } = await import("./lib/config");
  const { openDb } = await import("./lib/db/index");
  const { Repo } = await import("./lib/db/repo");
  const { Agent } = await import("./lib/agent/agent");
  const { buildToolServer } = await import("./lib/tools/index");
  const { assemble } = await import("./lib/assemble");
  const { OneBotClient } = await import("./lib/onebot/client");

  const g = globalThis as unknown as { __agentBooted?: boolean };
  if (g.__agentBooted) return; // 单例守卫
  g.__agentBooted = true;

  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const repo = new Repo(db);
  const agent = new Agent({
    model: cfg.model,
    systemPrompt: "",
    toolServer: buildToolServer(repo),
  });

  assemble({
    repo,
    botQQ: cfg.botQQ,
    adminGroupId: cfg.adminGroupId,
    timeoutMin: cfg.handoffTimeoutMin,
    agent,
  });

  const client = new OneBotClient(cfg.onebotWsUrl, cfg.onebotAccessToken);
  client.start();
  console.log("[agent] OneBot 客服 Agent 已启动");
}
