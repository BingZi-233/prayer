import type Database from "better-sqlite3";

export interface KbHit {
  id: number;
  content: string;
  source: string | null;
  distance: number;
}

export type ProactiveQuality = "ok" | "bad" | null;
export type ReflectionStatus = "pending" | "approved" | "rejected";

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

  isHumanMode(key: string): boolean {
    const row = this.db.prepare("SELECT human_mode FROM sessions WHERE key = ?").get(key) as
      | { human_mode: number }
      | undefined;
    return !!row?.human_mode;
  }

  setHumanMode(key: string, on: boolean): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (key, human_mode, human_since, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           human_mode = excluded.human_mode,
           human_since = excluded.human_since,
           updated_at = excluded.updated_at`
      )
      .run(key, on ? 1 : 0, on ? now : null, now);
  }

  setLastQuestion(key: string, question: string): void {
    const q = question.slice(0, 500);
    this.db
      .prepare(
        `INSERT INTO sessions (key, last_question, updated_at) VALUES (?, ?, unixepoch('subsec')*1000)
         ON CONFLICT(key) DO UPDATE SET last_question = excluded.last_question, updated_at = excluded.updated_at`
      )
      .run(key, q);
  }

  // 超时扫描:human_mode=1 且 human_since 早于 cutoff 的会话
  expiredHumanSessions(cutoffMs: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT key FROM sessions WHERE human_mode = 1 AND human_since IS NOT NULL AND human_since < ?`
      )
      .all(cutoffMs) as { key: string }[];
    return rows.map((r) => r.key);
  }

  // 群消息缓冲(被动反思用):落库。messageId 供主动回复引用原消息;缺省 → NULL(不引用)
  bufferGroupMessage(
    groupId: number,
    userId: number,
    senderRole: string | null,
    text: string,
    messageId?: number
  ): void {
    this.db
      .prepare(
        "INSERT INTO group_messages (group_id, user_id, sender_role, text, message_id) VALUES (?, ?, ?, ?, ?)"
      )
      .run(groupId, userId, senderRole, text, messageId ?? null);
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
  insertProactiveReply(groupId: number, userId: number, question: string, answer: string): number {
    const info = this.db
      .prepare("INSERT INTO proactive_replies (group_id, user_id, question, answer) VALUES (?, ?, ?, ?)")
      .run(groupId, userId, question, answer);
    return Number(info.lastInsertRowid);
  }

  setProactiveQuality(id: number, quality: "ok" | "bad"): boolean {
    const info = this.db.prepare("UPDATE proactive_replies SET quality = ? WHERE id = ?").run(quality, id);
    return info.changes > 0;
  }

  // 最近主动回复(降序),监控页插话列表用
  proactiveReplies(limit: number): {
    id: number;
    groupId: number;
    userId: number;
    question: string;
    answer: string;
    quality: ProactiveQuality;
    ts: number;
  }[] {
    const rows = this.db
      .prepare(
        "SELECT id, group_id, user_id, question, answer, quality, created_at FROM proactive_replies ORDER BY id DESC LIMIT ?"
      )
      .all(limit) as {
      id: number;
      group_id: number;
      user_id: number;
      question: string;
      answer: string;
      quality: string | null;
      created_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      userId: r.user_id,
      question: r.question,
      answer: r.answer,
      quality: (r.quality === "ok" || r.quality === "bad" ? r.quality : null) as ProactiveQuality,
      ts: r.created_at,
    }));
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

  proactiveBadCount(sinceTs?: number): number {
    if (sinceTs != null) {
      return (
        this.db
          .prepare("SELECT COUNT(*) n FROM proactive_replies WHERE quality = 'bad' AND created_at >= ?")
          .get(sinceTs) as { n: number }
      ).n;
    }
    return (this.db.prepare("SELECT COUNT(*) n FROM proactive_replies WHERE quality = 'bad'").get() as { n: number }).n;
  }

  // 某群 (afterTs, untilTs] 内的非管理发言(member/NULL),升序。主动兜底候选原料。
  groupMemberMessagesBetween(
    groupId: number,
    afterTs: number,
    untilTs: number
  ): { userId: number; text: string; createdAt: number; messageId: number | null }[] {
    const rows = this.db
      .prepare(
        `SELECT user_id, text, created_at, message_id FROM group_messages
         WHERE group_id = ? AND created_at > ? AND created_at <= ?
           AND (sender_role IS NULL OR sender_role NOT IN ('owner','admin'))
         ORDER BY created_at ASC`
      )
      .all(groupId, afterTs, untilTs) as {
      user_id: number;
      text: string;
      created_at: number;
      message_id: number | null;
    }[];
    return rows.map((r) => ({ userId: r.user_id, text: r.text, createdAt: r.created_at, messageId: r.message_id }));
  }

  // 反思游标(每群独立,已处理到的时间戳),复用 config 表。
  // 每群独立 → 单群处理抛错时只该群不推进、下轮重试,不牵连其他群。
  groupReflectCursor(groupId: number): number {
    return Number(this.getConfigRow(`reflect_cursor:${groupId}`) ?? "0");
  }

  setGroupReflectCursor(groupId: number, ts: number): void {
    this.setConfigRow(`reflect_cursor:${groupId}`, String(ts));
  }

  // 全局反思整理游标(上次整理完成时间戳),复用 config 表。
  // 持久化 → 进程重启/热重载后按 now-cursor 到期判定补跑,不随内存定时器清零(修复整理永不触发)。
  compactAt(): number {
    return Number(this.getConfigRow("reflect_compact_at") ?? "0");
  }

  setCompactAt(ts: number): void {
    this.setConfigRow("reflect_compact_at", String(ts));
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

  // 反思沉淀的知识条目(doc='human-reflection');source 格式 human-reflection:{gid}:{ts},畸形回退 null。
  // LEFT JOIN reflection_meta 带出来源问答(整理后条目 gid=0、无 meta → question/answer 为 null)
  reflectionEntries(): {
    id: number;
    content: string;
    groupId: number | null;
    ts: number | null;
    question: string | null;
    answer: string | null;
    status: ReflectionStatus;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.content, c.source, m.question, m.answer, COALESCE(m.status, 'pending') AS status
         FROM kb_chunks c LEFT JOIN reflection_meta m ON m.chunk_id = c.id
         WHERE c.doc = 'human-reflection' ORDER BY c.id DESC`
      )
      .all() as {
      id: number;
      content: string;
      source: string | null;
      question: string | null;
      answer: string | null;
      status: string;
    }[];
    return rows.map((r) => {
      const m = /^human-reflection:(\d+):(\d+)$/.exec(r.source ?? "");
      const st = r.status === "approved" || r.status === "rejected" ? r.status : "pending";
      return {
        id: r.id,
        content: r.content,
        groupId: m ? Number(m[1]) : null,
        ts: m ? Number(m[2]) : null,
        question: r.question,
        answer: r.answer,
        status: st as ReflectionStatus,
      };
    });
  }

  // 记录一条沉淀的来源问答(chunk_id 对应 kb_chunks.id)。poller 沉淀后调用。
  insertReflectionMeta(chunkId: number, groupId: number, question: string, answer: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO reflection_meta (chunk_id, group_id, question, answer, status) VALUES (?, ?, ?, ?, 'pending')"
      )
      .run(chunkId, groupId, question, answer);
  }

  setReflectionStatus(chunkId: number, status: ReflectionStatus): boolean {
    // 无 meta 的压缩条目:补一行再更新
    const exists = this.db.prepare("SELECT 1 FROM reflection_meta WHERE chunk_id = ?").get(chunkId);
    if (!exists) {
      this.db
        .prepare("INSERT INTO reflection_meta (chunk_id, group_id, question, answer, status) VALUES (?, NULL, NULL, NULL, ?)")
        .run(chunkId, status);
      return true;
    }
    const info = this.db.prepare("UPDATE reflection_meta SET status = ? WHERE chunk_id = ?").run(status, chunkId);
    return info.changes > 0;
  }

  // 升格为正式文档:复制 content 到 docs/kb 风格的 chunk(doc=promoted),并标 approved
  promoteReflection(chunkId: number): { ok: boolean; newId?: number; content?: string } {
    const row = this.db.prepare("SELECT content FROM kb_chunks WHERE id = ? AND doc = 'human-reflection'").get(chunkId) as
      | { content: string }
      | undefined;
    if (!row) return { ok: false };
    // 标记审核通过;实际写文件由 API 层处理,此处只改状态
    this.setReflectionStatus(chunkId, "approved");
    return { ok: true, content: row.content };
  }

  // 最近 N 次整理记录(倒序),before/after 内容内联(解析 JSON)
  recentCompactions(limit: number): {
    id: number;
    ts: number;
    beforeCount: number;
    afterCount: number;
    before: string[];
    after: string[];
  }[] {
    const rows = this.db
      .prepare(
        "SELECT id, ts, before_count, after_count, before_json, after_json FROM reflect_compactions ORDER BY ts DESC LIMIT ?"
      )
      .all(limit) as {
      id: number;
      ts: number;
      before_count: number;
      after_count: number;
      before_json: string;
      after_json: string;
    }[];
    const parse = (s: string): string[] => {
      try {
        const v = JSON.parse(s);
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    };
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      beforeCount: r.before_count,
      afterCount: r.after_count,
      before: parse(r.before_json),
      after: parse(r.after_json),
    }));
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

  closeTicket(id: number): boolean {
    const info = this.db.prepare("UPDATE tickets SET status = 'closed' WHERE id = ? AND status = 'open'").run(id);
    return info.changes > 0;
  }

  closeOpenTicketsForSession(sessionKey: string): number {
    const info = this.db
      .prepare("UPDATE tickets SET status = 'closed' WHERE session_key = ? AND status = 'open'")
      .run(sessionKey);
    return info.changes;
  }

  getTicket(id: number): { id: number; sessionKey: string; summary: string; status: string; createdAt: number } | undefined {
    const r = this.db.prepare("SELECT id, session_key, summary, status, created_at FROM tickets WHERE id = ?").get(id) as
      | { id: number; session_key: string; summary: string; status: string; created_at: number }
      | undefined;
    if (!r) return undefined;
    return { id: r.id, sessionKey: r.session_key, summary: r.summary, status: r.status, createdAt: r.created_at };
  }

  insertResolution(
    kind: string,
    opts: { sessionKey?: string; groupId?: number; userId?: number; detail?: string } = {}
  ): void {
    this.db
      .prepare(
        "INSERT INTO resolution_events (kind, session_key, group_id, user_id, detail) VALUES (?, ?, ?, ?, ?)"
      )
      .run(kind, opts.sessionKey ?? null, opts.groupId ?? null, opts.userId ?? null, opts.detail ?? null);
  }

  // sinceTs 起各 kind 计数;用于日看板 / 自动解决率
  resolutionCounts(sinceTs: number): Record<string, number> {
    const rows = this.db
      .prepare(
        "SELECT kind, COUNT(*) AS n FROM resolution_events WHERE created_at >= ? GROUP BY kind"
      )
      .all(sinceTs) as { kind: string; n: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.kind] = r.n;
    return out;
  }

  // 用量日持久化:增量累加
  addUsageDaily(
    day: string,
    site: string,
    d: { count: number; cacheRead: number; cacheCreation: number; input: number; output: number; costUsd: number }
  ): void {
    this.db
      .prepare(
        `INSERT INTO usage_daily (day, site, count, cache_read, cache_creation, input, output, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day, site) DO UPDATE SET
           count = count + excluded.count,
           cache_read = cache_read + excluded.cache_read,
           cache_creation = cache_creation + excluded.cache_creation,
           input = input + excluded.input,
           output = output + excluded.output,
           cost_usd = cost_usd + excluded.cost_usd`
      )
      .run(day, site, d.count, d.cacheRead, d.cacheCreation, d.input, d.output, d.costUsd);
  }

  usageDaily(day: string): {
    site: string;
    count: number;
    cacheRead: number;
    cacheCreation: number;
    input: number;
    output: number;
    costUsd: number;
  }[] {
    const rows = this.db
      .prepare(
        "SELECT site, count, cache_read, cache_creation, input, output, cost_usd FROM usage_daily WHERE day = ?"
      )
      .all(day) as {
      site: string;
      count: number;
      cache_read: number;
      cache_creation: number;
      input: number;
      output: number;
      cost_usd: number;
    }[];
    return rows.map((r) => ({
      site: r.site,
      count: r.count,
      cacheRead: r.cache_read,
      cacheCreation: r.cache_creation,
      input: r.input,
      output: r.output,
      costUsd: r.cost_usd,
    }));
  }

  usageDailyTotalCost(day: string): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS n FROM usage_daily WHERE day = ?").get(day) as {
      n: number;
    };
    return row.n;
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

  // 只在基础文档(doc != human-reflection)里做向量近邻,供压缩整理取权威上下文。
  // vec0 KNN 混合反思与基础条目;反思聚集时前 N 名可能被反思占满,故逐步放大候选池
  // 直到凑够 k 条基础条目或达上限(2000),避免静默少取。
  searchBaseKb(query: Float32Array, k: number): KbHit[] {
    const buf = Buffer.from(query.buffer);
    const stmt = this.db.prepare(
      `SELECT c.id, c.content, c.source, v.distance
       FROM kb_vec v JOIN kb_chunks c ON c.id = v.chunk_id
       WHERE v.embedding MATCH ? AND k = ?
         AND c.doc != 'human-reflection'
       ORDER BY v.distance`
    );
    for (const cand of [k * 4, k * 16, 2000]) {
      const rows = stmt.all(buf, cand) as KbHit[];
      if (rows.length >= k || cand >= 2000) return rows.slice(0, k);
    }
    return [];
  }

  // 整体替换反思库(压缩整理用):单事务只删“快照内”的 human-reflection 条目(按 id,不按 doc),
  // 再插入整理结果 —— 避免删掉压缩 await 期间 poller 并发新增的条目(那些会永久丢失,因 poller 游标已推进、源消息已剪枝)。
  // source 统一 human-reflection:0:{ts}(gid 0 = 已压缩,全局归属)。
  // beforeContents/afterContents:整理前后条目文本快照,事务内记入 reflect_compactions 供 web 追溯差异
  replaceReflectionEntries(
    oldIds: number[],
    entries: { content: string; embedding: Float32Array }[],
    sourceTs: number,
    beforeContents: string[] = [],
    afterContents: string[] = []
  ): void {
    this.db.transaction(() => {
      if (oldIds.length) {
        const ph = oldIds.map(() => "?").join(",");
        this.db.prepare(`DELETE FROM kb_vec WHERE chunk_id IN (${ph})`).run(...oldIds);
        this.db.prepare(`DELETE FROM kb_chunks WHERE id IN (${ph})`).run(...oldIds);
        // 删被替换 chunk 的来源 meta,避免孤儿(整理后条目 gid=0、无 meta)
        this.db.prepare(`DELETE FROM reflection_meta WHERE chunk_id IN (${ph})`).run(...oldIds);
      }
      for (const e of entries) {
        const id = this.insertKbChunk("human-reflection", e.content, `human-reflection:0:${sourceTs}`);
        this.insertKbVec(id, e.embedding);
      }
      this.db
        .prepare(
          "INSERT INTO reflect_compactions (ts, before_count, after_count, before_json, after_json) VALUES (?, ?, ?, ?, ?)"
        )
        .run(sourceTs, beforeContents.length, afterContents.length, JSON.stringify(beforeContents), JSON.stringify(afterContents));
    })();
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
    key: string; sessionId: string | null; active: boolean; humanMode: boolean;
    humanSince: number | null; lastQuestion: string | null; updatedAt: number;
  }[] {
    const rows = this.db
      .prepare("SELECT key, session_id, resume_id, human_mode, human_since, last_question, updated_at FROM sessions ORDER BY updated_at DESC")
      .all() as {
        key: string; session_id: string | null; resume_id: string | null; human_mode: number;
        human_since: number | null; last_question: string | null; updated_at: number;
      }[];
    return rows.map((r) => ({
      key: r.key,
      sessionId: r.session_id,
      active: r.resume_id !== null, // 有续接指针 → 下条消息接续当前对话;否则将开新会话
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
