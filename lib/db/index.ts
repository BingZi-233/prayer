import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { migrateDatabase } from "./migrations/index.ts"

export const DIM = 512 // bge-small-zh-v1.5 输出维度

export function openDb(path: string, dim: number = DIM): Database.Database {
  const db = new Database(path)
  try {
    db.pragma("journal_mode = WAL")
    sqliteVec.load(db)
    migrateDatabase(db, dim)
    return db
  } catch (error) {
    // 启动失败时立即释放文件句柄，避免阻塞修复或恢复数据库。
    db.close()
    throw error
  }
}

export {
  ensurePerfIndexes,
  ensureQuestionTopicUnique,
  ensureSeenMessagesCreatedIndex,
  migrateLegacySessionKeys,
} from "./migrations/index.ts"
