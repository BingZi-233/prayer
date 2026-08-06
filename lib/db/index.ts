import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { legacySessionKeyToCanonical } from "../channels/ids.ts"

const DIM = 512 // bge-small-zh-v1.5 输出维度

export function openDb(path: string, dim: number = DIM): Database.Database {
  const db = new Database(path)
  db.pragma("journal_mode = WAL")
  sqliteVec.load(db)
  migrate(db, dim)
  return db
}

function userVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true }) ?? 0)
}

function setUserVersion(db: Database.Database, v: number): void {
  db.pragma(`user_version = ${v}`)
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { ok: number } | undefined
  return !!row
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string
  }[]
  return new Set(rows.map((r) => r.name))
}

function columnType(
  db: Database.Database,
  table: string,
  col: string
): string | undefined {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string
    type: string
  }[]
  return rows.find((r) => r.name === col)?.type
}

function migrate(db: Database.Database, dim: number): void {
  const version = userVersion(db)

  if (version < 2) {
    // 先确保 v1 形态表存在(旧库 / 全新库),再破坏性升到 v2
    createV1Tables(db, dim)
    applyV1Patches(db)
    db.transaction(() => {
      migrateToV2(db)
    })()
    setUserVersion(db, 2)
  } else {
    // 已是 v2:幂等确保表结构(防空库误标 version 等极端情况)
    createV2Tables(db, dim)
  }

  // v3: sessions.prior_since + 用户消息 lookback 索引(幂等)
  if (userVersion(db) < 3) {
    ensureSessionsPriorSince(db)
    ensureGmUserTimeIndex(db)
    setUserVersion(db, 3)
  } else {
    ensureSessionsPriorSince(db)
    ensureGmUserTimeIndex(db)
  }

  // v4: group_messages.mentioned_bot(@bot 消息标记;主动补位不拿它当候选,幂等)
  if (userVersion(db) < 4) {
    ensureGmMentionedBot(db)
    setUserVersion(db, 4)
  } else {
    ensureGmMentionedBot(db)
  }
}

/** v4: group_messages 补 mentioned_bot 列(已存在则跳过) */
function ensureGmMentionedBot(db: Database.Database): void {
  if (!tableExists(db, "group_messages")) return
  if (!tableColumns(db, "group_messages").has("mentioned_bot")) {
    db.exec(
      "ALTER TABLE group_messages ADD COLUMN mentioned_bot INTEGER NOT NULL DEFAULT 0"
    )
  }
}

/** v3: sessions 补 prior_since 列(已存在则跳过) */
function ensureSessionsPriorSince(db: Database.Database): void {
  if (!tableExists(db, "sessions")) return
  if (!tableColumns(db, "sessions").has("prior_since")) {
    db.exec("ALTER TABLE sessions ADD COLUMN prior_since INTEGER")
  }
}

/** v3: group_messages 用户 lookback 复合索引 */
function ensureGmUserTimeIndex(db: Database.Database): void {
  if (!tableExists(db, "group_messages")) return
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gm_channel_group_user_time
      ON group_messages(channel, group_id, user_id, created_at, id)
  `)
}

/** v1 基线表(升级前源形态)。全新库也会先建这套再 migrateToV2。 */
function createV1Tables(db: Database.Database, dim: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,
      session_id TEXT,
      resume_id TEXT,
      human_mode INTEGER NOT NULL DEFAULT 0,
      human_since INTEGER,
      last_question TEXT,
      prior_since INTEGER,
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
  `)
}

/** v1 旧库补列 / 唯一索引(升 v2 前跑,保证拷贝源完整) */
function applyV1Patches(db: Database.Database): void {
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN resume_id TEXT")
    db.exec(
      "UPDATE sessions SET resume_id = session_id WHERE session_id IS NOT NULL"
    )
  } catch {
    /* 列已存在 */
  }
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN last_question TEXT")
  } catch {
    /* 列已存在 */
  }
  try {
    db.exec("ALTER TABLE group_messages ADD COLUMN message_id INTEGER")
  } catch {
    /* 列已存在 */
  }
  // message_id 唯一化(v1):迁移前先清重复,v2 会换成 (channel, group_id, message_id)
  const hasGmMsgIdIdx = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_gm_message_id'"
    )
    .get()
  if (!hasGmMsgIdIdx && tableExists(db, "group_messages")) {
    const cols = tableColumns(db, "group_messages")
    // 仅旧 int 形态需要;已有 channel 列说明已是 v2
    if (!cols.has("channel")) {
      db.exec(`
        DELETE FROM group_messages
         WHERE message_id IS NOT NULL
           AND id NOT IN (
             SELECT MIN(id) FROM group_messages
              WHERE message_id IS NOT NULL GROUP BY message_id
           );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_message_id ON group_messages(message_id);
      `)
    }
  }
  try {
    db.exec("ALTER TABLE proactive_replies ADD COLUMN quality TEXT")
  } catch {
    /* 列已存在 */
  }
  try {
    db.exec(
      "ALTER TABLE reflection_meta ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'"
    )
  } catch {
    /* 列已存在 */
  }
  try {
    db.exec(
      "UPDATE reflection_meta SET status = 'approved' WHERE status = 'pending'"
    )
    db.exec(`
      INSERT OR IGNORE INTO reflection_meta (chunk_id, group_id, question, answer, status)
      SELECT c.id, NULL, NULL, NULL, 'approved'
      FROM kb_chunks c
      WHERE c.doc = 'human-reflection'
        AND NOT EXISTS (SELECT 1 FROM reflection_meta m WHERE m.chunk_id = c.id)
    `)
  } catch {
    /* 表/列不存在等极端情况忽略 */
  }
}

/**
 * 破坏性升到 user_version=2:channel + TEXT id。
 * 各表按列探测跳过(部分失败重跑安全)。
 */
function migrateToV2(db: Database.Database): void {
  migrateSeenMessages(db)
  migrateGroupMessages(db)
  migrateProactiveReplies(db)
  migrateResolutionEvents(db)
  migrateQuestionOccurrences(db)
  migrateReflectionMeta(db)
  migrateLegacySessionKeys(db)
  migrateConfigCursors(db)
}

function migrateSeenMessages(db: Database.Database): void {
  if (!tableExists(db, "seen_messages")) {
    db.exec(`
      CREATE TABLE seen_messages (
        dedupe_key TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
    `)
    return
  }
  const cols = tableColumns(db, "seen_messages")
  if (cols.has("dedupe_key")) return // 已是 v2
  // 清空重建:旧 message_id 整数无法无损映射到 channel 级 dedupe_key
  db.exec(`
    DROP TABLE seen_messages;
    CREATE TABLE seen_messages (
      dedupe_key TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
  `)
}

function migrateGroupMessages(db: Database.Database): void {
  if (!tableExists(db, "group_messages")) {
    createGroupMessagesV2(db)
    return
  }
  const cols = tableColumns(db, "group_messages")
  if (
    cols.has("channel") &&
    columnType(db, "group_messages", "group_id") === "TEXT"
  ) {
    // 已是 v2;确保索引
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_channel_msg
        ON group_messages(channel, group_id, message_id);
      CREATE INDEX IF NOT EXISTS idx_gm_channel_group_time
        ON group_messages(channel, group_id, created_at);
    `)
    return
  }

  db.exec(`
    CREATE TABLE group_messages_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'qq',
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sender_role TEXT,
      text TEXT NOT NULL,
      message_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
  `)

  // 拷贝并去重:同 (channel, group_id, message_id) 留最早 id;NULL message_id 全保留
  db.exec(`
    INSERT INTO group_messages_v2 (id, channel, group_id, user_id, sender_role, text, message_id, created_at)
    SELECT id, 'qq', CAST(group_id AS TEXT), CAST(user_id AS TEXT), sender_role, text,
           CASE WHEN message_id IS NULL THEN NULL ELSE CAST(message_id AS TEXT) END,
           created_at
    FROM group_messages
    WHERE message_id IS NULL
       OR id IN (
         SELECT MIN(id) FROM group_messages
          WHERE message_id IS NOT NULL
          GROUP BY message_id
       );
  `)

  db.exec(`
    DROP TABLE group_messages;
    ALTER TABLE group_messages_v2 RENAME TO group_messages;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_channel_msg
      ON group_messages(channel, group_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_gm_channel_group_time
      ON group_messages(channel, group_id, created_at);
  `)
}

function createGroupMessagesV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'qq',
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sender_role TEXT,
      text TEXT NOT NULL,
      message_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_channel_msg
      ON group_messages(channel, group_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_gm_channel_group_time
      ON group_messages(channel, group_id, created_at);
  `)
}

function migrateProactiveReplies(db: Database.Database): void {
  if (!tableExists(db, "proactive_replies")) {
    createProactiveRepliesV2(db)
    return
  }
  const cols = tableColumns(db, "proactive_replies")
  if (
    cols.has("channel") &&
    columnType(db, "proactive_replies", "group_id") === "TEXT"
  ) {
    return
  }
  const hasQuality = cols.has("quality")
  db.exec(`
    CREATE TABLE proactive_replies_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'qq',
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      quality TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
  `)
  if (hasQuality) {
    db.exec(`
      INSERT INTO proactive_replies_v2 (id, channel, group_id, user_id, question, answer, quality, created_at)
      SELECT id, 'qq', CAST(group_id AS TEXT), CAST(user_id AS TEXT), question, answer, quality, created_at
      FROM proactive_replies;
    `)
  } else {
    db.exec(`
      INSERT INTO proactive_replies_v2 (id, channel, group_id, user_id, question, answer, quality, created_at)
      SELECT id, 'qq', CAST(group_id AS TEXT), CAST(user_id AS TEXT), question, answer, NULL, created_at
      FROM proactive_replies;
    `)
  }
  db.exec(`
    DROP TABLE proactive_replies;
    ALTER TABLE proactive_replies_v2 RENAME TO proactive_replies;
    CREATE INDEX IF NOT EXISTS idx_pr_time ON proactive_replies(created_at);
  `)
}

function createProactiveRepliesV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proactive_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'qq',
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      quality TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_pr_time ON proactive_replies(created_at);
  `)
}

function migrateResolutionEvents(db: Database.Database): void {
  if (!tableExists(db, "resolution_events")) {
    createResolutionEventsV2(db)
    return
  }
  const cols = tableColumns(db, "resolution_events")
  if (
    cols.has("channel") &&
    columnType(db, "resolution_events", "group_id") === "TEXT"
  ) {
    // 仍迁移 session_key(幂等)
    migrateResolutionSessionKeys(db)
    return
  }
  db.exec(`
    CREATE TABLE resolution_events_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      session_key TEXT,
      channel TEXT,
      group_id TEXT,
      user_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
  `)
  // 在 JS 侧迁移 session_key → canonical,并回填 channel/group/user
  const rows = db
    .prepare(
      "SELECT id, kind, session_key, group_id, user_id, detail, created_at FROM resolution_events"
    )
    .all() as {
    id: number
    kind: string
    session_key: string | null
    group_id: number | null
    user_id: number | null
    detail: string | null
    created_at: number
  }[]
  const ins = db.prepare(
    `INSERT INTO resolution_events_v2
      (id, kind, session_key, channel, group_id, user_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const r of rows) {
    const sessionKey = r.session_key
      ? legacySessionKeyToCanonical(r.session_key)
      : null
    const channel = "qq"
    const groupId = r.group_id != null ? String(r.group_id) : null
    const userId = r.user_id != null ? String(r.user_id) : null
    ins.run(
      r.id,
      r.kind,
      sessionKey,
      channel,
      groupId,
      userId,
      r.detail,
      r.created_at
    )
  }
  db.exec(`
    DROP TABLE resolution_events;
    ALTER TABLE resolution_events_v2 RENAME TO resolution_events;
    CREATE INDEX IF NOT EXISTS idx_re_kind_time ON resolution_events(kind, created_at);
  `)
}

function migrateResolutionSessionKeys(db: Database.Database): void {
  const rows = db
    .prepare(
      "SELECT id, session_key FROM resolution_events WHERE session_key IS NOT NULL"
    )
    .all() as { id: number; session_key: string }[]
  const upd = db.prepare(
    "UPDATE resolution_events SET session_key = ? WHERE id = ?"
  )
  for (const r of rows) {
    const next = legacySessionKeyToCanonical(r.session_key)
    if (next !== r.session_key) upd.run(next, r.id)
  }
}

function createResolutionEventsV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolution_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      session_key TEXT,
      channel TEXT,
      group_id TEXT,
      user_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_re_kind_time ON resolution_events(kind, created_at);
  `)
}

function migrateQuestionOccurrences(db: Database.Database): void {
  if (!tableExists(db, "question_occurrences")) {
    createQuestionOccurrencesV2(db)
    return
  }
  const cols = tableColumns(db, "question_occurrences")
  if (
    cols.has("channel") &&
    columnType(db, "question_occurrences", "group_id") === "TEXT"
  ) {
    return
  }
  db.exec(`
    CREATE TABLE question_occurrences_v2 (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id   INTEGER NOT NULL,
      channel    TEXT NOT NULL DEFAULT 'qq',
      group_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      msg_ts     INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    INSERT INTO question_occurrences_v2
      (id, topic_id, channel, group_id, user_id, text, msg_ts, created_at)
    SELECT id, topic_id, 'qq', CAST(group_id AS TEXT), CAST(user_id AS TEXT),
           text, msg_ts, created_at
    FROM question_occurrences;
    DROP TABLE question_occurrences;
    ALTER TABLE question_occurrences_v2 RENAME TO question_occurrences;
    CREATE INDEX IF NOT EXISTS idx_qo_topic ON question_occurrences(topic_id);
    CREATE INDEX IF NOT EXISTS idx_qo_ts ON question_occurrences(msg_ts);
  `)
}

function createQuestionOccurrencesV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS question_occurrences (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id   INTEGER NOT NULL,
      channel    TEXT NOT NULL DEFAULT 'qq',
      group_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      msg_ts     INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_qo_topic ON question_occurrences(topic_id);
    CREATE INDEX IF NOT EXISTS idx_qo_ts ON question_occurrences(msg_ts);
  `)
}

function migrateReflectionMeta(db: Database.Database): void {
  if (!tableExists(db, "reflection_meta")) {
    createReflectionMetaV2(db)
    return
  }
  const cols = tableColumns(db, "reflection_meta")
  if (
    cols.has("channel") &&
    (columnType(db, "reflection_meta", "group_id") === "TEXT" ||
      !cols.has("group_id"))
  ) {
    return
  }
  // group_id 可能是 INTEGER;有 channel 但 group_id 仍 INTEGER 也重建
  if (
    cols.has("channel") &&
    columnType(db, "reflection_meta", "group_id") === "TEXT"
  ) {
    return
  }
  const hasStatus = cols.has("status")
  db.exec(`
    CREATE TABLE reflection_meta_v2 (
      chunk_id INTEGER PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'qq',
      group_id TEXT,
      question TEXT,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
  `)
  if (hasStatus) {
    db.exec(`
      INSERT INTO reflection_meta_v2 (chunk_id, channel, group_id, question, answer, status, created_at)
      SELECT chunk_id, 'qq',
             CASE WHEN group_id IS NULL THEN NULL ELSE CAST(group_id AS TEXT) END,
             question, answer, COALESCE(status, 'approved'), created_at
      FROM reflection_meta;
    `)
  } else {
    db.exec(`
      INSERT INTO reflection_meta_v2 (chunk_id, channel, group_id, question, answer, status, created_at)
      SELECT chunk_id, 'qq',
             CASE WHEN group_id IS NULL THEN NULL ELSE CAST(group_id AS TEXT) END,
             question, answer, 'approved', created_at
      FROM reflection_meta;
    `)
  }
  db.exec(`
    DROP TABLE reflection_meta;
    ALTER TABLE reflection_meta_v2 RENAME TO reflection_meta;
  `)
}

function createReflectionMetaV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reflection_meta (
      chunk_id INTEGER PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'qq',
      group_id TEXT,
      question TEXT,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
  `)
}

/**
 * sessions.key / tickets.session_key: 旧 `gid:uid` → `qq:gid:uid`。
 * sessions PK 冲突时保留 updated_at 较大者。
 * 导出供测试/手动补跑。
 */
export function migrateLegacySessionKeys(db: Database.Database): void {
  if (tableExists(db, "sessions")) {
    // prior_since 为 v3 列:存在则一并迁移,避免 rewrite 时丢纪元
    const hasPriorSince = tableColumns(db, "sessions").has("prior_since")
    type SessRow = {
      key: string
      session_id: string | null
      resume_id: string | null
      human_mode: number
      human_since: number | null
      last_question: string | null
      prior_since?: number | null
      updated_at: number
    }
    const rows = db
      .prepare(
        hasPriorSince
          ? "SELECT key, session_id, resume_id, human_mode, human_since, last_question, prior_since, updated_at FROM sessions"
          : "SELECT key, session_id, resume_id, human_mode, human_since, last_question, updated_at FROM sessions"
      )
      .all() as SessRow[]

    // 按 canonical key 分组,冲突留 updated_at 最大
    const best = new Map<string, SessRow>()
    for (const r of rows) {
      const canon = legacySessionKeyToCanonical(r.key)
      const prev = best.get(canon)
      if (!prev || r.updated_at >= prev.updated_at) {
        best.set(canon, { ...r, key: canon })
      }
    }

    // 仅当有 key 变化或冲突需要折叠时重写
    const needsRewrite =
      rows.some((r) => legacySessionKeyToCanonical(r.key) !== r.key) ||
      best.size !== rows.length
    if (needsRewrite) {
      db.exec("DELETE FROM sessions")
      const ins = db.prepare(
        hasPriorSince
          ? `INSERT INTO sessions
              (key, session_id, resume_id, human_mode, human_since, last_question, prior_since, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          : `INSERT INTO sessions
              (key, session_id, resume_id, human_mode, human_since, last_question, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      for (const r of best.values()) {
        if (hasPriorSince) {
          ins.run(
            r.key,
            r.session_id,
            r.resume_id,
            r.human_mode,
            r.human_since,
            r.last_question,
            r.prior_since ?? null,
            r.updated_at
          )
        } else {
          ins.run(
            r.key,
            r.session_id,
            r.resume_id,
            r.human_mode,
            r.human_since,
            r.last_question,
            r.updated_at
          )
        }
      }
    }
  }

  if (tableExists(db, "tickets")) {
    const tickets = db.prepare("SELECT id, session_key FROM tickets").all() as {
      id: number
      session_key: string
    }[]
    const upd = db.prepare("UPDATE tickets SET session_key = ? WHERE id = ?")
    for (const t of tickets) {
      const next = legacySessionKeyToCanonical(t.session_key)
      if (next !== t.session_key) upd.run(next, t.id)
    }
  }

  if (tableExists(db, "resolution_events")) {
    migrateResolutionSessionKeys(db)
  }
}

/** config 游标键:reflect_cursor:{n} → reflect_cursor:qq:{n}(已带 channel 不重复迁) */
function migrateConfigCursors(db: Database.Database): void {
  if (!tableExists(db, "config")) return
  const prefixes = ["reflect_cursor", "topic_cursor", "proactive_cursor"]
  const rows = db
    .prepare("SELECT key, value, updated_at FROM config")
    .all() as { key: string; value: string; updated_at: number }[]
  const del = db.prepare("DELETE FROM config WHERE key = ?")
  const upsert = db.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  )
  for (const r of rows) {
    for (const p of prefixes) {
      // 仅裸数字后缀:已是 channel:chatId 的不动
      const m = new RegExp(`^${p}:(\\d+)$`).exec(r.key)
      if (!m) continue
      const nextKey = `${p}:qq:${m[1]}`
      del.run(r.key)
      // 若目标键已存在,保留 updated_at 较新的 value
      const existing = db
        .prepare("SELECT value, updated_at FROM config WHERE key = ?")
        .get(nextKey) as { value: string; updated_at: number } | undefined
      if (existing && existing.updated_at > r.updated_at) {
        // 保留已有新键
      } else {
        upsert.run(nextKey, r.value, r.updated_at)
      }
      break
    }
  }
}

/** 已是 v2 时的幂等建表(全套最终形态) */
function createV2Tables(db: Database.Database, dim: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,
      session_id TEXT,
      resume_id TEXT,
      human_mode INTEGER NOT NULL DEFAULT 0,
      human_since INTEGER,
      last_question TEXT,
      prior_since INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS seen_messages (
      dedupe_key TEXT PRIMARY KEY,
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
    CREATE TABLE IF NOT EXISTS reflect_compactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      before_count INTEGER NOT NULL,
      after_count INTEGER NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rc_ts ON reflect_compactions(ts);
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
  `)
  createGroupMessagesV2(db)
  createProactiveRepliesV2(db)
  createResolutionEventsV2(db)
  createQuestionOccurrencesV2(db)
  createReflectionMetaV2(db)
}

export { DIM }
