import type Database from "better-sqlite3"
import { openDb } from "./index.ts"
import { Repo } from "./repo.ts"
import { canonicalDbPath, databaseOpenPath } from "./path.ts"

export { canonicalDbPath } from "./path.ts"

// 按路径缓存 DB 连接(挂 globalThis,长驻 Next 进程内复用)。
// 避免 API 路由每请求都 openDb → 泄漏连接 + 重复 migrate/扩展加载。
const g = globalThis as unknown as {
  __dbCache?: Map<string, Database.Database>
  __repoCache?: Map<string, Repo>
}

/** 按数据库路径复用仓储实例，确保跨请求共享连接与语句缓存。 */
export function sharedRepo(path: string): Repo {
  const key = databaseOpenPath(canonicalDbPath(path))
  const cache = g.__repoCache ?? (g.__repoCache = new Map())
  let repo = cache.get(key)
  if (!repo) {
    repo = new Repo(sharedDb(key))
    cache.set(key, repo)
  }
  return repo
}

export function sharedDb(path: string): Database.Database {
  const key = databaseOpenPath(canonicalDbPath(path))
  const cache = g.__dbCache ?? (g.__dbCache = new Map())
  let db = cache.get(key)
  if (!db) {
    db = openDb(key)
    cache.set(key, db)
  }
  return db
}
