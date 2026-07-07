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

  // 一键清所有会话的 resume_id → 每个会话下条消息各自开全新对话;session_id 保留,网页历史仍可查。
  // 返回受影响(此前仍有 resume_id)的会话数,供后台提示。
  clearAllResumeIds(): number {
    const info = this.db
      .prepare("UPDATE sessions SET resume_id = NULL, updated_at = unixepoch('subsec')*1000 WHERE resume_id IS NOT NULL")
      .run();
    return info.changes;
  }

  getSessionId(key: string): string | undefined {
    const row = this.db.prepare("SELECT session_id FROM sessions WHERE key = ?").get(key) as
      | { session_id: string | null }
      | undefined;
    return row?.session_id ?? undefined;
  }

  // 续接指针:reset 后为空 → Agent 不 resume,开新会话。
  // maxIdleMs > 0 时惰性过期:距上次活动(updated_at)超时则视为无 resume,下条消息开新会话
  // (不改库,session_id 仍在 → 网页可查历史);maxIdleMs <= 0 关闭过期。
  getResumeId(key: string, maxIdleMs = 0): string | undefined {
    const row = this.db
      .prepare(
        `SELECT resume_id FROM sessions
         WHERE key = ? AND (? <= 0 OR updated_at >= unixepoch('subsec') * 1000 - ?)`
      )
      .get(key, maxIdleMs, maxIdleMs) as { resume_id: string | null } | undefined;
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

  // 上界 untilTs 前存在 owner/admin 发言的候选 group,去重(每群游标另判 band)
  groupsWithAdminMessagesUpTo(untilTs: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT group_id FROM group_messages
         WHERE created_at <= ? AND sender_role IN ('owner','admin')
         ORDER BY group_id`
      )
      .all(untilTs) as { group_id: number }[];
    return rows.map((r) => r.group_id);
  }

  // 某群 (afterTs, untilTs] 内是否有 owner/admin 发言
  hasAdminMessageBetween(groupId: number, afterTs: number, untilTs: number): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM group_messages
         WHERE group_id = ? AND created_at > ? AND created_at <= ? AND sender_role IN ('owner','admin')
         LIMIT 1`
      )
      .get(groupId, afterTs, untilTs);
    return !!row;
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

  // 会话最后活动时间(主链路 @处理 / 兜底都会 setSessionId 刷新)。主动兜底压制②用:
  // 该值 > 问题 ts → 该用户已被主链路处理或已兜底过 → 不重复插话。
  sessionUpdatedAt(key: string): number | undefined {
    const row = this.db.prepare("SELECT updated_at FROM sessions WHERE key = ?").get(key) as
      | { updated_at: number }
      | undefined;
    return row?.updated_at;
  }

  // 主动兜底游标(每群独立,已扫描到的时间戳),复用 config 表,照抄 reflect cursor。
  groupProactiveCursor(groupId: number): number {
    return Number(this.getConfigRow(`proactive_cursor:${groupId}`) ?? "0");
  }

  setGroupProactiveCursor(groupId: number, ts: number): void {
    this.setConfigRow(`proactive_cursor:${groupId}`, String(ts));
  }

  // 主动回复命中留痕:每次真正主动补位一句就记一行,供监控页看历史/次数。
  insertProactiveReply(groupId: number, userId: number, question: string, answer: string): void {
    this.db
      .prepare("INSERT INTO proactive_replies (group_id, user_id, question, answer) VALUES (?, ?, ?, ?)")
      .run(groupId, userId, question, answer);
  }

  // 最近主动回复(降序),监控页插话列表用
  proactiveReplies(limit: number): { id: number; groupId: number; userId: number; question: string; answer: string; ts: number }[] {
    const rows = this.db
      .prepare("SELECT id, group_id, user_id, question, answer, created_at FROM proactive_replies ORDER BY id DESC LIMIT ?")
      .all(limit) as { id: number; group_id: number; user_id: number; question: string; answer: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, groupId: r.group_id, userId: r.user_id, question: r.question, answer: r.answer, ts: r.created_at }));
  }

  // 每群主动回复数 + 最近一条时间,监控页每群行用
  proactiveGroupCounts(): { groupId: number; count: number; lastTs: number }[] {
    return this.db
      .prepare("SELECT group_id AS groupId, COUNT(*) AS count, MAX(created_at) AS lastTs FROM proactive_replies GROUP BY group_id")
      .all() as { groupId: number; count: number; lastTs: number }[];
  }

  // 主动回复总数
  proactiveTotalCount(): number {
    return (this.db.prepare("SELECT COUNT(*) n FROM proactive_replies").get() as { n: number }).n;
  }

  // 某群 (afterTs, untilTs] 内的非管理发言(member/NULL),升序。主动兜底候选原料。
  groupMemberMessagesBetween(
    groupId: number,
    afterTs: number,
    untilTs: number
  ): { userId: number; text: string; createdAt: number }[] {
    const rows = this.db
      .prepare(
        `SELECT user_id, text, created_at FROM group_messages
         WHERE group_id = ? AND created_at > ? AND created_at <= ?
           AND (sender_role IS NULL OR sender_role NOT IN ('owner','admin'))
         ORDER BY created_at ASC`
      )
      .all(groupId, afterTs, untilTs) as { user_id: number; text: string; created_at: number }[];
    return rows.map((r) => ({ userId: r.user_id, text: r.text, createdAt: r.created_at }));
  }

  // 反思游标(每群独立,已处理到的时间戳),复用 config 表。
  // 每群独立 → 单群处理抛错时只该群不推进、下轮重试,不牵连其他群。
  groupReflectCursor(groupId: number): number {
    return Number(this.getConfigRow(`reflect_cursor:${groupId}`) ?? "0");
  }

  setGroupReflectCursor(groupId: number, ts: number): void {
    this.setConfigRow(`reflect_cursor:${groupId}`, String(ts));
  }

  // 每群反思游标(config key = reflect_cursor:{gid}),供反思/群活动页展示进度
  reflectCursors(): { groupId: number; cursor: number }[] {
    const rows = this.db
      .prepare("SELECT key, value FROM config WHERE key LIKE 'reflect_cursor:%'")
      .all() as { key: string; value: string }[];
    return rows.map((r) => ({ groupId: Number(r.key.slice("reflect_cursor:".length)), cursor: Number(r.value) }));
  }

  // 每群缓冲消息量 + 最近一条时间(反思原料规模)
  groupMessageStats(): { groupId: number; count: number; lastTs: number }[] {
    return this.db
      .prepare("SELECT group_id AS groupId, COUNT(*) AS count, MAX(created_at) AS lastTs FROM group_messages GROUP BY group_id")
      .all() as { groupId: number; count: number; lastTs: number }[];
  }

  // 反思沉淀的知识条目(doc='human-reflection');source 格式 human-reflection:{gid}:{ts},畸形回退 null
  reflectionEntries(): { id: number; content: string; groupId: number | null; ts: number | null }[] {
    const rows = this.db
      .prepare("SELECT id, content, source FROM kb_chunks WHERE doc = 'human-reflection' ORDER BY id DESC")
      .all() as { id: number; content: string; source: string | null }[];
    return rows.map((r) => {
      const m = /^human-reflection:(\d+):(\d+)$/.exec(r.source ?? "");
      return { id: r.id, content: r.content, groupId: m ? Number(m[1]) : null, ts: m ? Number(m[2]) : null };
    });
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

  // 向量库预览:总量(chunks 与已建向量数,便于发现漏 embed 的孤儿 chunk)
  kbTotals(): { chunks: number; vecs: number } {
    const chunks = (this.db.prepare("SELECT COUNT(*) n FROM kb_chunks").get() as { n: number }).n;
    const vecs = (this.db.prepare("SELECT COUNT(*) n FROM kb_vec").get() as { n: number }).n;
    return { chunks, vecs };
  }

  // 按 doc 分组的 chunk 数,doc 升序(与文件列表同一相对路径标识)
  kbDocStats(): { doc: string; chunks: number }[] {
    return this.db
      .prepare("SELECT doc, COUNT(*) chunks FROM kb_chunks GROUP BY doc ORDER BY doc")
      .all() as { doc: string; chunks: number }[];
  }

  // 单 doc 的分块内容,按 id 升序(即入库/切分顺序)
  kbChunksByDoc(doc: string): { id: number; content: string }[] {
    return this.db
      .prepare("SELECT id, content FROM kb_chunks WHERE doc = ? ORDER BY id")
      .all(doc) as { id: number; content: string }[];
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

  listSessions(): {
    key: string; sessionId: string | null; humanMode: boolean;
    humanSince: number | null; lastQuestion: string | null; updatedAt: number;
  }[] {
    const rows = this.db
      .prepare("SELECT key, session_id, human_mode, human_since, last_question, updated_at FROM sessions ORDER BY updated_at DESC")
      .all() as {
        key: string; session_id: string | null; human_mode: number;
        human_since: number | null; last_question: string | null; updated_at: number;
      }[];
    return rows.map((r) => ({
      key: r.key,
      sessionId: r.session_id,
      humanMode: !!r.human_mode,
      humanSince: r.human_since,
      lastQuestion: r.last_question,
      updatedAt: r.updated_at,
    }));
  }

  openTickets(): { id: number; sessionKey: string; summary: string; createdAt: number }[] {
    const rows = this.db
      .prepare("SELECT id, session_key, summary, created_at FROM tickets WHERE status = 'open' ORDER BY created_at DESC")
      .all() as { id: number; session_key: string; summary: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, sessionKey: r.session_key, summary: r.summary, createdAt: r.created_at }));
  }

  listTickets(): { id: number; sessionKey: string; summary: string; status: string; createdAt: number }[] {
    const rows = this.db
      .prepare("SELECT id, session_key, summary, status, created_at FROM tickets ORDER BY created_at DESC")
      .all() as { id: number; session_key: string; summary: string; status: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, sessionKey: r.session_key, summary: r.summary, status: r.status, createdAt: r.created_at }));
  }
}
