import { getConfig, type AppConfig } from "./config-store"
import { sharedRepo } from "./db/shared"
import type { Repo } from "./db/repo"

export interface AppContext {
  configRepo: Repo
  cfg: AppConfig
  repo: Repo
}

export function getAppContext(
  env: Record<string, string | undefined> = process.env
): AppContext {
  const configRepo = sharedRepo(env.DB_PATH ?? "./data/agent.db")
  const cfg = getConfig(configRepo, env)
  return { configRepo, cfg, repo: sharedRepo(cfg.dbPath) }
}
