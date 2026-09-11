export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const g = globalThis as unknown as { __agentBooted?: boolean }
  if (g.__agentBooted) return
  g.__agentBooted = true

  const { captureConsole } = await import("./lib/core/logger")
  const { openDb } = await import("./lib/core/db/index")
  const { Repo } = await import("./lib/core/db/repo")
  const { getConfig } = await import("./lib/core/config-store")
  const { getRuntime, defaultBuilders } = await import("./lib/runtime")

  captureConsole()

  // 读配置(首启从 env 种子入库)
  const seedDb = openDb(process.env.DB_PATH ?? "./data/agent.db")
  const cfg = getConfig(new Repo(seedDb))
  seedDb.close()

  const builders = await defaultBuilders()
  await getRuntime().start(cfg, builders)

  // 预热本地嵌入模型:首次 embed 要加载模型(数秒),不预热则第一条真实用户消息
  // 会在预检索里撞上超时、白白退回纯 kb_search 路径。后台不阻塞启动。
  if (cfg.kbPrefetchEnabled) {
    void import("./lib/tools/embed")
      .then(({ embed }) => embed("预热"))
      .catch((e) => console.warn("[agent] 嵌入模型预热失败:", e))
  }

  console.log("[agent] OneBot 客服 Agent 已启动")
}
