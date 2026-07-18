export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as unknown as { __agentBooted?: boolean };
  if (g.__agentBooted) return;
  g.__agentBooted = true;

  const { captureConsole } = await import("./lib/logger");
  const { openDb } = await import("./lib/db/index");
  const { Repo } = await import("./lib/db/repo");
  const { getConfig } = await import("./lib/config-store");
  const { getRuntime, defaultBuilders } = await import("./lib/runtime");

  captureConsole();

  // 读配置(首启从 env 种子入库)
  const seedDb = openDb(process.env.DB_PATH ?? "./data/agent.db");
  const cfg = getConfig(new Repo(seedDb));
  seedDb.close();

  const builders = await defaultBuilders();
  await getRuntime().start(cfg, builders);
  console.log("[agent] OneBot 客服 Agent 已启动");
}
