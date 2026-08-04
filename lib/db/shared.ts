import type Database from "better-sqlite3"
import { openDb } from "./index.ts"

// 按路径缓存 DB 连接(挂 globalThis,长驻 Next 进程内复用)。
// 避免 API 路由每请求都 openDb → 泄漏连接 + 重复 migrate/扩展加载。
const g = globalThis as unknown as {
  __dbCache?: Map<string, Database.Database>
}

export function sharedDb(path: string): Database.Database {
  const cache = g.__dbCache ?? (g.__dbCache = new Map())
  let db = cache.get(path)
  if (!db) {
    db = openDb(path)
    cache.set(path, db)
  }
  return db
}
