import type Database from "better-sqlite3";

export interface KbHit {
  id: number;
  content: string;
  source: string | null;
  distance: number;
}

export class Repo {
  constructor(private db: Database.Database) {}

  // 记住会话:session_id(展示,网页读 transcript)与 resume_id(续接)同步写入
  setSessionId(key: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (key, session_id, resume_id) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id, resume_id = excluded.resume_id, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, sessionId, sessionId);
  }

  // 仅清 resume_id → 下条消息开全新 SDK session;保留 session_id 供网页仍能查看历史
  clearResumeId(key: string): void {
    this.db
      .prepare("UPDATE sessions SET resume_id = NULL, updated_at = unixepoch('subsec')*1000 WHERE key = ?")
      .run(key);
  }

  getSessionId(key: string): string | undefined {
    const row = this.db.prepare("SELECT session_id FROM sessions WHERE key = ?").get(key) as
      | { session_id: string | null }
      | undefined;
    return row?.session_id ?? undefined;
  }

  // 续接指针:reset 后为空 → Agent 不 resume,开新会话
  getResumeId(key: string): string | undefined {
    const row = this.db.prepare("SELECT resume_id FROM sessions WHERE key = ?").get(key) as
      | { resume_id: string | null }
      | undefined;
    return row?.resume_id ?? undefined;
  }

  // 群消息缓冲(被动反思用):落库
  bufferGroupMessage(groupId: number, userId: number, senderRole: string | null, text: string): void {
    this.db
      .prepare(
        "INSERT INTO group_messages (group_id, user_id, sender_role, text) VALUES (?, ?, ?, ?)"
      )
      .run(groupId, userId, senderRole, text);
  }

  // 指定时间带 (afterTs, untilTs] 内含 owner/admin 发言的 group,去重
  groupsWithAdminMessagesBetween(afterTs: number, untilTs: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT group_id FROM group_messages
         WHERE created_at > ? AND created_at <= ? AND sender_role IN ('owner','admin')
         ORDER BY group_id`
      )
      .all(afterTs, untilTs) as { group_id: number }[];
    return rows.map((r) => r.group_id);
  }

  // 某群 sinceTs 之后最近 limit 条,按时间升序返回
  groupMessageWindow(
    groupId: number,
    sinceTs: number,
    limit: number
  ): { userId: number; senderRole: string | null; text: string; createdAt: number }[] {
    const rows = this.db
      .prepare(
        `SELECT user_id, sender_role, text, created_at FROM group_messages
         WHERE group_id = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(groupId, sinceTs, limit) as {
      user_id: number;
      sender_role: string | null;
      text: string;
      created_at: number;
    }[];
    return rows
      .map((r) => ({ userId: r.user_id, senderRole: r.sender_role, text: r.text, createdAt: r.created_at }))
      .reverse();
  }

  // 反思窗口:cursor 之前最近 preLimit 条(问题上下文) + cursor 之后至 nowTs 的消息
  // (band 与后续确认,升序,上限 postLimit)。band 属 (cursor,nowTs] 的最旧端,ASC LIMIT 必留,不会被后续消息挤出。
  groupReflectionWindow(
    groupId: number,
    cursor: number,
    nowTs: number,
    preLimit: number,
    postLimit: number
  ): { userId: number; senderRole: string | null; text: string; createdAt: number }[] {
    type Row = { user_id: number; sender_role: string | null; text: string; created_at: number };
    const map = (r: Row) => ({ userId: r.user_id, senderRole: r.sender_role, text: r.text, createdAt: r.created_at });
    const pre = (
      this.db
        .prepare(
          `SELECT user_id, sender_role, text, created_at FROM group_messages
           WHERE group_id = ? AND created_at <= ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(groupId, cursor, preLimit) as Row[]
    )
      .map(map)
      .reverse();
    const post = (
      this.db
        .prepare(
          `SELECT user_id, sender_role, text, created_at FROM group_messages
           WHERE group_id = ? AND created_at > ? AND created_at <= ?
           ORDER BY created_at ASC LIMIT ?`
        )
        .all(groupId, cursor, nowTs, postLimit) as Row[]
    ).map(map);
    return [...pre, ...post];
  }

  // KB 原子写入:chunk + 向量同一事务,避免 embed/向量插入失败时残留孤儿 chunk
  insertKbEntry(doc: string, content: string, source: string, embedding: Float32Array): number {
    return this.db.transaction(() => {
      const id = this.insertKbChunk(doc, content, source);
      this.insertKbVec(id, embedding);
      return id;
    })();
  }

  pruneGroupMessages(beforeTs: number): void {
    this.db.prepare("DELETE FROM group_messages WHERE created_at < ?").run(beforeTs);
  }

  // 反思游标(已处理到的时间戳),复用 config 表
  reflectCursor(): number {
    return Number(this.getConfigRow("reflect_cursor") ?? "0");
  }

  setReflectCursor(ts: number): void {
    this.setConfigRow("reflect_cursor", String(ts));
  }

  seenMessage(messageId: number): boolean {
    const info = this.db
      .prepare("INSERT OR IGNORE INTO seen_messages (message_id) VALUES (?)")
      .run(messageId);
    return info.changes === 0;
  }

  createTicket(sessionKey: string, summary: string): number {
    const info = this.db
      .prepare("INSERT INTO tickets (session_key, summary) VALUES (?, ?)")
      .run(sessionKey, summary);
    return Number(info.lastInsertRowid);
  }

  insertKbChunk(doc: string, content: string, source: string): number {
    const info = this.db
      .prepare("INSERT INTO kb_chunks (doc, content, source) VALUES (?, ?, ?)")
      .run(doc, content, source);
    return Number(info.lastInsertRowid);
  }

  insertKbVec(chunkId: number, embedding: Float32Array): void {
    this.db
      .prepare("INSERT INTO kb_vec (chunk_id, embedding) VALUES (?, ?)")
      .run(BigInt(chunkId), Buffer.from(embedding.buffer));
  }

  searchKb(query: Float32Array, k: number): KbHit[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.content, c.source, v.distance
         FROM kb_vec v JOIN kb_chunks c ON c.id = v.chunk_id
         WHERE v.embedding MATCH ? AND k = ?
         ORDER BY v.distance`
      )
      .all(Buffer.from(query.buffer), k) as KbHit[];
    return rows;
  }

  getConfigRow(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setConfigRow(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, value);
  }

  countSessions(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    return row.n;
  }

  listSessions(): { key: string; sessionId: string | null; humanMode: boolean; updatedAt: number }[] {
    const rows = this.db
      .prepare("SELECT key, session_id, human_mode, updated_at FROM sessions ORDER BY updated_at DESC")
      .all() as { key: string; session_id: string | null; human_mode: number; updated_at: number }[];
    return rows.map((r) => ({
      key: r.key,
      sessionId: r.session_id,
      humanMode: !!r.human_mode,
      updatedAt: r.updated_at,
    }));
  }

  openTickets(): { id: number; sessionKey: string; summary: string; createdAt: number }[] {
    const rows = this.db
      .prepare("SELECT id, session_key, summary, created_at FROM tickets WHERE status = 'open' ORDER BY created_at DESC")
      .all() as { id: number; session_key: string; summary: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, sessionKey: r.session_key, summary: r.summary, createdAt: r.created_at }));
  }
}
