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
    CREATE TABLE IF NOT EXISTS proactive_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_pr_time ON proactive_replies(created_at);
    CREATE TABLE IF NOT EXISTS reflect_compactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      before_count INTEGER NOT NULL,
      after_count INTEGER NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rc_ts ON reflect_compactions(ts);
    CREATE TABLE IF NOT EXISTS reflection_meta (
      chunk_id INTEGER PRIMARY KEY,
      group_id INTEGER,
      question TEXT,
      answer TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS resolution_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      session_key TEXT,
      group_id INTEGER,
      user_id INTEGER,
      detail TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_re_kind_time ON resolution_events(kind, created_at);
    CREATE TABLE IF NOT EXISTS usage_daily (
      day TEXT NOT NULL,
      site TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_creation INTEGER NOT NULL DEFAULT 0,
      input INTEGER NOT NULL DEFAULT 0,
      output INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (day, site)
    );
    -- QQ 群名 / 用户名缓存(分表;数字 id 可能撞车)。exp 为毫秒时间戳,过期后 API 重新打 OneBot。
    CREATE TABLE IF NOT EXISTS name_cache_groups_list (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      rows_json TEXT NOT NULL,
      exp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS name_cache_group (
      group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      exp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS name_cache_user (
      user_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      exp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS name_cache_members (
      group_id INTEGER PRIMARY KEY,
      rows_json TEXT NOT NULL,
      exp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS question_topics (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS question_occurrences (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id   INTEGER NOT NULL,
      group_id   INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      text       TEXT NOT NULL,
      msg_ts     INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_qo_topic ON question_occurrences(topic_id);
    CREATE INDEX IF NOT EXISTS idx_qo_ts ON question_occurrences(msg_ts);
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
  // 旧库补 message_id(主动回复引用原消息用);旧行为 NULL → 不引用,退化纯文本。重复加列报错忽略
  try {
    db.exec("ALTER TABLE group_messages ADD COLUMN message_id INTEGER");
  } catch {
    /* 列已存在 */
  }
  // 主动补位质检:null=未评 / ok / bad
  try {
    db.exec("ALTER TABLE proactive_replies ADD COLUMN quality TEXT");
  } catch {
    /* 列已存在 */
  }
  // 反思状态:approved(默认入库) / rejected(人工驳回) / pending(遗留)。沉淀无需审核。
  try {
    db.exec("ALTER TABLE reflection_meta ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
  } catch {
    /* 列已存在 */
  }
  // 旧数据对齐:历史 pending 升 approved;无 meta 的 human-reflection 补一行(默认入库)
  try {
    db.exec("UPDATE reflection_meta SET status = 'approved' WHERE status = 'pending'");
    db.exec(`
      INSERT OR IGNORE INTO reflection_meta (chunk_id, group_id, question, answer, status)
      SELECT c.id, NULL, NULL, NULL, 'approved'
      FROM kb_chunks c
      WHERE c.doc = 'human-reflection'
        AND NOT EXISTS (SELECT 1 FROM reflection_meta m WHERE m.chunk_id = c.id)
    `);
  } catch {
    /* 表/列不存在等极端情况忽略 */
  }
}

export { DIM };
