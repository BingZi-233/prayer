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
      human_mode INTEGER NOT NULL DEFAULT 0,
      human_since INTEGER,
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
  `);
}

export { DIM };
