import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const DIM = 512; // bge-small-zh-v1.5 输出维度

export function openDb(path: string, dim: number = DIM): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  sqliteVec.load(db);
  migrate(db, dim);
  return db;
}

function migrate(db: Database.Database, dim: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,
      session_id TEXT,
      resume_id TEXT,
      human_mode INTEGER NOT NULL DEFAULT 0,
      human_since INTEGER,
      last_question TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS seen_messages (
      message_id INTEGER PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding FLOAT[${dim}]
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      sender_role TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_gm_group_time ON group_messages(group_id, created_at);
  `);
  // 旧库补列(resume_id 拆分自 session_id);新库已含,重复加列报错忽略。
  // 回填仅在首次加列时执行(ALTER 成功后),旧 session_id 兼作续接指针,保持既有 resume 行为;
  // 后续启动 ALTER 抛错跳过回填,避免把已 reset 的 resume_id 重新填回。
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN resume_id TEXT");
    db.exec("UPDATE sessions SET resume_id = session_id WHERE session_id IS NOT NULL");
  } catch {
    /* 列已存在 */
  }
  // 旧库补 last_question(转人工问题,反思沉淀用);重复加列报错忽略
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN last_question TEXT");
  } catch {
    /* 列已存在 */
  }
}

export { DIM };
