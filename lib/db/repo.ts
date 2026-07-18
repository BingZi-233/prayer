import type Database from "better-sqlite3"

export interface KbHit {
  id: number
  content: string
  source: string | null
  distance: number
}

export type ProactiveQuality = "ok" | "bad" | null
export type ReflectionStatus = "pending" | "approved" | "rejected" | "promoted"

export interface ChatRef {
  channel: string
  chatId: string
}

/** 解析反思 source:新 human-reflection:{channel}:{chatId}:{ts};旧 human-reflection:{gid}:{ts}→qq */
export function parseReflectionSource(
  source: string | null
): { channel: string; chatId: string; ts: number } | null {
  if (!source?.startsWith("human-reflection:")) return null
  const rest = source.slice("human-reflection:".length)
  const parts = rest.split(":")
  // 新格式:至少 channel + chatId + ts
  if (parts.length >= 3) {
    const channel = parts[0]
    // 已知 channel 前缀,或非纯数字首段(避免把旧 gid 误当 channel)
    if (channel === "qq" || channel === "tg" || channel === "discord") {
      const ts = Number(parts[parts.length - 1])
      if (!Number.isFinite(ts)) return null
      const chatId = parts.slice(1, -1).join(":")
      if (!chatId) return null
      return { channel, chatId, ts }
    }
  }
  // 旧格式:human-reflection:{qqGroupId}:{ts}
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return { channel: "qq", chatId: parts[0], ts: Number(parts[1]) }
  }
  return null
}

export class Repo {
  constructor(private db: Database.Database) {}

  // 通用事务包装:回调内多次写用同一连接,全成功才提交
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  // 记住会话:session_id(展示,网页读 transcript)与 resume_id(续接)同步写入
  setSessionId(key: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (key, session_id, resume_id) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id, resume_id = excluded.resume_id, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, sessionId, sessionId)
  }

  // 仅清 resume_id → 下条消息开全新 SDK session;保留 session_id 供网页仍能查看历史
  clearResumeId(key: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET resume_id = NULL, updated_at = unixepoch('subsec')*1000 WHERE key = ?"
      )
      .run(key)
  }

  // 一键清所有会话的 resume_id → 每个会话下条消息各自开全新对话;session_id 保留,网页历史仍可查。
  // 返回受影响(此前仍有 resume_id)的会话数,供后台提示。
  clearAllResumeIds(): number {
    const info = this.db
      .prepare(
        "UPDATE sessions SET resume_id = NULL, updated_at = unixepoch('subsec')*1000 WHERE resume_id IS NOT NULL"
      )
      .run()
    return info.changes
  }

  getSessionId(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT session_id FROM sessions WHERE key = ?")
      .get(key) as { session_id: string | null } | undefined
    return row?.session_id ?? undefined
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
      .get(key, maxIdleMs, maxIdleMs) as { resume_id: string | null } | undefined
    return row?.resume_id ?? undefined
  }

  isHumanMode(key: string): boolean {
    const row = this.db
      .prepare("SELECT human_mode FROM sessions WHERE key = ?")
      .get(key) as { human_mode: number } | undefined
    return !!row?.human_mode
  }

  setHumanMode(key: string, on: boolean): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO sessions (key, human_mode, human_since, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           human_mode = excluded.human_mode,
           human_since = excluded.human_since,
           updated_at = excluded.updated_at`
      )
      .run(key, on ? 1 : 0, on ? now : null, now)
  }

  setLastQuestion(key: string, question: string): void {
    const q = question.slice(0, 500)
    this.db
      .prepare(
        `INSERT INTO sessions (key, last_question, updated_at) VALUES (?, ?, unixepoch('subsec')*1000)
         ON CONFLICT(key) DO UPDATE SET last_question = excluded.last_question, updated_at = excluded.updated_at`
      )
      .run(key, q)
  }

  // 超时扫描:human_mode=1 且 human_since 早于 cutoff 的会话
  expiredHumanSessions(cutoffMs: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT key FROM sessions WHERE human_mode = 1 AND human_since IS NOT NULL AND human_since < ?`
      )
      .all(cutoffMs) as { key: string }[]
    return rows.map((r) => r.key)
  }

  // 群消息缓冲(被动反思用):落库。messageId 供主动回复引用原消息;缺省 → NULL(不引用)。
  // OR IGNORE + (channel, group_id, message_id) 唯一索引:多实例/重推时同一消息只落一行(NULL 不去重)。
  bufferGroupMessage(
    channel: string,
    chatId: string,
    userId: string,
    senderRole: string | null,
    text: string,
    messageId?: string | null
  ): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO group_messages (channel, group_id, user_id, sender_role, text, message_id) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(channel, chatId, userId, senderRole, text, messageId ?? null)
  }

  // 上界 untilTs 前存在 owner/admin 发言的候选 chat,去重(每群游标另判 band)
  groupsWithAdminMessagesUpTo(untilTs: number): ChatRef[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT channel, group_id FROM group_messages
         WHERE created_at <= ? AND sender_role IN ('owner','admin')
         ORDER BY channel, group_id`
      )
      .all(untilTs) as { channel: string; group_id: string }[]
    return rows.map((r) => ({ channel: r.channel, chatId: r.group_id }))
  }

  // 某 chat (afterTs, untilTs] 内是否有 owner/admin 发言
  hasAdminMessageBetween(
    channel: string,
    chatId: string,
    afterTs: number,
    untilTs: number
  ): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM group_messages
         WHERE channel = ? AND group_id = ? AND created_at > ? AND created_at <= ?
           AND sender_role IN ('owner','admin')
         LIMIT 1`
      )
      .get(channel, chatId, afterTs, untilTs)
    return !!row
  }

  // 某 chat sinceTs 之后最近 limit 条,按时间升序返回
  groupMessageWindow(
    channel: string,
    chatId: string,
    sinceTs: number,
    limit: number
  ): {
    userId: string
    senderRole: string | null
    text: string
    createdAt: number
  }[] {
    const rows = this.db
      .prepare(
        `SELECT user_id, sender_role, text, created_at FROM group_messages
         WHERE channel = ? AND group_id = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(channel, chatId, sinceTs, limit) as {
      user_id: string
      sender_role: string | null
      text: string
      created_at: number
    }[]
    return rows
      .map((r) => ({
        userId: r.user_id,
        senderRole: r.sender_role,
        text: r.text,
        createdAt: r.created_at,
      }))
      .reverse()
  }

  // 反思窗口:cursor 之前最近 preLimit 条(问题上下文) + cursor 之后至 nowTs 的消息
  // (band 与后续确认,升序,上限 postLimit)。band 属 (cursor,nowTs] 的最旧端,ASC LIMIT 必留,不会被后续消息挤出。
  groupReflectionWindow(
    channel: string,
    chatId: string,
    cursor: number,
    nowTs: number,
    preLimit: number,
    postLimit: number
  ): {
    userId: string
    senderRole: string | null
    text: string
    createdAt: number
  }[] {
    type Row = {
      user_id: string
      sender_role: string | null
      text: string
      created_at: number
    }
    const map = (r: Row) => ({
      userId: r.user_id,
      senderRole: r.sender_role,
      text: r.text,
      createdAt: r.created_at,
    })
    const pre = (
      this.db
        .prepare(
          `SELECT user_id, sender_role, text, created_at FROM group_messages
           WHERE channel = ? AND group_id = ? AND created_at <= ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(channel, chatId, cursor, preLimit) as Row[]
    )
      .map(map)
      .reverse()
    const post = (
      this.db
        .prepare(
          `SELECT user_id, sender_role, text, created_at FROM group_messages
           WHERE channel = ? AND group_id = ? AND created_at > ? AND created_at <= ?
           ORDER BY created_at ASC LIMIT ?`
        )
        .all(channel, chatId, cursor, nowTs, postLimit) as Row[]
    ).map(map)
    return [...pre, ...post]
  }

  // KB 原子写入:chunk + 向量同一事务,避免 embed/向量插入失败时残留孤儿 chunk
  insertKbEntry(
    doc: string,
    content: string,
    source: string,
    embedding: Float32Array
  ): number {
    return this.db.transaction(() => {
      const id = this.insertKbChunk(doc, content, source)
      this.insertKbVec(id, embedding)
      return id
    })()
  }

  pruneGroupMessages(beforeTs: number): void {
    this.db
      .prepare("DELETE FROM group_messages WHERE created_at < ?")
      .run(beforeTs)
  }

  // 会话最后活动时间(主链路 @处理 / 兜底都会 setSessionId 刷新)。主动兜底压制②用:
  // 该值 > 问题 ts → 该用户已被主链路处理或已兜底过 → 不重复插话。
  sessionUpdatedAt(key: string): number | undefined {
    const row = this.db
      .prepare("SELECT updated_at FROM sessions WHERE key = ?")
      .get(key) as { updated_at: number } | undefined
    return row?.updated_at
  }

  // 主动兜底游标(每 chat 独立,已扫描到的时间戳),复用 config 表
  groupProactiveCursor(channel: string, chatId: string): number {
    return Number(
      this.getConfigRow(`proactive_cursor:${channel}:${chatId}`) ?? "0"
    )
  }

  setGroupProactiveCursor(channel: string, chatId: string, ts: number): void {
    this.setConfigRow(`proactive_cursor:${channel}:${chatId}`, String(ts))
  }

  // 主动回复命中留痕:每次真正主动补位一句就记一行,供监控页看历史/次数。
  insertProactiveReply(
    channel: string,
    chatId: string,
    userId: string,
    question: string,
    answer: string
  ): number {
    const info = this.db
      .prepare(
        "INSERT INTO proactive_replies (channel, group_id, user_id, question, answer) VALUES (?, ?, ?, ?, ?)"
      )
      .run(channel, chatId, userId, question, answer)
    return Number(info.lastInsertRowid)
  }

  setProactiveQuality(id: number, quality: "ok" | "bad"): boolean {
    const info = this.db
      .prepare("UPDATE proactive_replies SET quality = ? WHERE id = ?")
      .run(quality, id)
    return info.changes > 0
  }

  // 最近主动回复(降序),监控页插话列表用
  proactiveReplies(limit: number): {
    id: number
    channel: string
    chatId: string
    userId: string
    question: string
    answer: string
    quality: ProactiveQuality
    ts: number
  }[] {
    const rows = this.db
      .prepare(
        "SELECT id, channel, group_id, user_id, question, answer, quality, created_at FROM proactive_replies ORDER BY id DESC LIMIT ?"
      )
      .all(limit) as {
      id: number
      channel: string
      group_id: string
      user_id: string
      question: string
      answer: string
      quality: string | null
      created_at: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      chatId: r.group_id,
      userId: r.user_id,
      question: r.question,
      answer: r.answer,
      quality: (r.quality === "ok" || r.quality === "bad"
        ? r.quality
        : null) as ProactiveQuality,
      ts: r.created_at,
    }))
  }

  // 每 chat 主动回复数 + 最近一条时间,监控页每群行用
  proactiveGroupCounts(): {
    channel: string
    chatId: string
    count: number
    lastTs: number
  }[] {
    return this.db
      .prepare(
        `SELECT channel AS channel, group_id AS chatId, COUNT(*) AS count, MAX(created_at) AS lastTs
         FROM proactive_replies GROUP BY channel, group_id`
      )
      .all() as {
      channel: string
      chatId: string
      count: number
      lastTs: number
    }[]
  }

  // 主动回复总数
  proactiveTotalCount(): number {
    return (
      this.db.prepare("SELECT COUNT(*) n FROM proactive_replies").get() as {
        n: number
      }
    ).n
  }

  proactiveBadCount(sinceTs?: number): number {
    if (sinceTs != null) {
      return (
        this.db
          .prepare(
            "SELECT COUNT(*) n FROM proactive_replies WHERE quality = 'bad' AND created_at >= ?"
          )
          .get(sinceTs) as { n: number }
      ).n
    }
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) n FROM proactive_replies WHERE quality = 'bad'"
        )
        .get() as { n: number }
    ).n
  }

  // 某 chat (afterTs, untilTs] 内的非管理发言(member/NULL),升序。主动兜底候选原料。
  groupMemberMessagesBetween(
    channel: string,
    chatId: string,
    afterTs: number,
    untilTs: number
  ): {
    userId: string
    text: string
    createdAt: number
    messageId: string | null
  }[] {
    const rows = this.db
      .prepare(
        `SELECT user_id, text, created_at, message_id FROM group_messages
         WHERE channel = ? AND group_id = ? AND created_at > ? AND created_at <= ?
           AND (sender_role IS NULL OR sender_role NOT IN ('owner','admin'))
         ORDER BY created_at ASC`
      )
      .all(channel, chatId, afterTs, untilTs) as {
      user_id: string
      text: string
      created_at: number
      message_id: string | null
    }[]
    return rows.map((r) => ({
      userId: r.user_id,
      text: r.text,
      createdAt: r.created_at,
      messageId: r.message_id,
    }))
  }

  // 反思游标(每 chat 独立,已处理到的时间戳),复用 config 表。
  groupReflectCursor(channel: string, chatId: string): number {
    return Number(
      this.getConfigRow(`reflect_cursor:${channel}:${chatId}`) ?? "0"
    )
  }

  setGroupReflectCursor(channel: string, chatId: string, ts: number): void {
    this.setConfigRow(`reflect_cursor:${channel}:${chatId}`, String(ts))
  }

  // ── 问题排行榜 ──────────────────────────────────────────
  // 主题目录:同名(精确)复用,返回主题 id。近义归并由 poller 侧 textNearlySame 处理。
  insertQuestionTopic(title: string, now: number): number {
    const exist = this.db
      .prepare("SELECT id FROM question_topics WHERE title = ?")
      .get(title) as { id: number } | undefined
    if (exist) {
      this.db
        .prepare("UPDATE question_topics SET updated_at = ? WHERE id = ?")
        .run(now, exist.id)
      return exist.id
    }
    const info = this.db
      .prepare(
        "INSERT INTO question_topics (title, created_at, updated_at) VALUES (?, ?, ?)"
      )
      .run(title, now, now)
    return Number(info.lastInsertRowid)
  }

  insertQuestionOccurrence(
    topicId: number,
    channel: string,
    chatId: string,
    userId: string,
    text: string,
    msgTs: number
  ): void {
    this.db
      .prepare(
        "INSERT INTO question_occurrences (topic_id, channel, group_id, user_id, text, msg_ts) VALUES (?,?,?,?,?,?)"
      )
      .run(topicId, channel, chatId, userId, text, msgTs)
  }

  // 主题被再次命中时刷新活跃时间,保证热门主题留在 questionTopics 前排(喂 LLM 归并用)
  touchQuestionTopic(id: number, now: number): void {
    this.db
      .prepare("UPDATE question_topics SET updated_at = ? WHERE id = ?")
      .run(now, id)
  }

  // 现有主题清单(供 poller 喂 LLM 与近义归并),按最近活跃降序
  questionTopics(limit = 500): { id: number; title: string }[] {
    return this.db
      .prepare(
        "SELECT id, title FROM question_topics ORDER BY updated_at DESC LIMIT ?"
      )
      .all(limit) as { id: number; title: string }[]
  }

  // 每 chat 问题排行游标(config key = topic_cursor:{channel}:{chatId})
  topicCursor(channel: string, chatId: string): number {
    return Number(
      this.getConfigRow(`topic_cursor:${channel}:${chatId}`) ?? "0"
    )
  }

  setTopicCursor(channel: string, chatId: string, ts: number): void {
    this.setConfigRow(`topic_cursor:${channel}:${chatId}`, String(ts))
  }

  // 时间窗排行:msg_ts >= sinceTs 的归属按主题计数,降序。sinceTs=0 即全部。
  rankingByWindow(
    sinceTs: number
  ): { id: number; title: string; count: number; lastTs: number }[] {
    return this.db
      .prepare(
        `SELECT t.id AS id, t.title AS title, COUNT(o.id) AS count, MAX(o.msg_ts) AS lastTs
         FROM question_occurrences o
         JOIN question_topics t ON t.id = o.topic_id
         WHERE o.msg_ts >= ?
         GROUP BY t.id
         ORDER BY count DESC, lastTs DESC`
      )
      .all(sinceTs) as {
      id: number
      title: string
      count: number
      lastTs: number
    }[]
  }

  // 某主题窗口内代表问题样例,按最近降序。按 text 去重(同句重复发/转发只展示一次,计数不受影响)。
  topicSamples(topicId: number, limit: number, sinceTs = 0): string[] {
    const rows = this.db
      .prepare(
        `SELECT text, MAX(msg_ts) AS ts FROM question_occurrences
         WHERE topic_id = ? AND msg_ts >= ?
         GROUP BY text
         ORDER BY ts DESC LIMIT ?`
      )
      .all(topicId, sinceTs, limit) as { text: string; ts: number }[]
    return rows.map((r) => r.text)
  }

  // 生效 chat 中 topic 游标的最小值(忽略从未处理过的 0,避免恒卡 prune)。
  // 无任何 >0 游标 → MAX_SAFE_INTEGER(prune 不受 topic 侧约束)。
  // 接受 {channel, chatId}[] 或历史 number[](视为 qq 群号,Phase 0 兼容)。
  minTopicCursor(
    enabled: ChatRef[] | number[] | string[]
  ): number {
    let min = Number.MAX_SAFE_INTEGER
    for (const g of enabled) {
      let channel: string
      let chatId: string
      if (typeof g === "number") {
        channel = "qq"
        chatId = String(g)
      } else if (typeof g === "string") {
        // "qq:100" 或裸 "100"
        const m = /^([a-z]+):(.+)$/.exec(g)
        if (m) {
          channel = m[1]
          chatId = m[2]
        } else {
          channel = "qq"
          chatId = g
        }
      } else {
        channel = g.channel
        chatId = g.chatId
      }
      const c = this.topicCursor(channel, chatId)
      if (c > 0 && c < min) min = c
    }
    return min
  }

  // 全局反思整理游标(上次整理完成时间戳),复用 config 表。
  compactAt(): number {
    return Number(this.getConfigRow("reflect_compact_at") ?? "0")
  }

  setCompactAt(ts: number): void {
    this.setConfigRow("reflect_compact_at", String(ts))
  }

  // 全局反思自动升格游标(上次升格评审完成时间戳)
  promoteAt(): number {
    return Number(this.getConfigRow("reflect_promote_at") ?? "0")
  }

  setPromoteAt(ts: number): void {
    this.setConfigRow("reflect_promote_at", String(ts))
  }

  // 每 chat 反思游标(config key = reflect_cursor:{channel}:{chatId})
  reflectCursors(): { channel: string; chatId: string; cursor: number }[] {
    const rows = this.db
      .prepare("SELECT key, value FROM config WHERE key LIKE 'reflect_cursor:%'")
      .all() as { key: string; value: string }[]
    const out: { channel: string; chatId: string; cursor: number }[] = []
    for (const r of rows) {
      // reflect_cursor:{channel}:{chatId}
      const rest = r.key.slice("reflect_cursor:".length)
      const parts = rest.split(":")
      if (parts.length < 2) continue // 畸形/未迁移旧键忽略
      const channel = parts[0]
      const chatId = parts.slice(1).join(":")
      out.push({ channel, chatId, cursor: Number(r.value) })
    }
    return out
  }

  // 每 chat 缓冲消息量 + 最近一条时间(反思原料规模)
  groupMessageStats(): {
    channel: string
    chatId: string
    count: number
    lastTs: number
  }[] {
    return this.db
      .prepare(
        `SELECT channel AS channel, group_id AS chatId, COUNT(*) AS count, MAX(created_at) AS lastTs
         FROM group_messages GROUP BY channel, group_id`
      )
      .all() as {
      channel: string
      chatId: string
      count: number
      lastTs: number
    }[]
  }

  // 反思沉淀的知识条目(doc='human-reflection');source 见 parseReflectionSource。
  // LEFT JOIN reflection_meta 带出来源问答(整理后条目 chatId=0、无 meta → question/answer 为 null)
  // 无 meta / 未知 status 一律视为 approved(沉淀即入库,无需审核)
  reflectionEntries(): {
    id: number
    content: string
    channel: string | null
    chatId: string | null
    ts: number | null
    question: string | null
    answer: string | null
    status: ReflectionStatus
  }[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.content, c.source, m.question, m.answer, COALESCE(m.status, 'approved') AS status
         FROM kb_chunks c LEFT JOIN reflection_meta m ON m.chunk_id = c.id
         WHERE c.doc = 'human-reflection' ORDER BY c.id DESC`
      )
      .all() as {
      id: number
      content: string
      source: string | null
      question: string | null
      answer: string | null
      status: string
    }[]
    return rows.map((r) => {
      const parsed = parseReflectionSource(r.source)
      const st =
        r.status === "rejected" ||
        r.status === "pending" ||
        r.status === "promoted"
          ? r.status
          : "approved"
      return {
        id: r.id,
        content: r.content,
        channel: parsed?.channel ?? null,
        chatId: parsed?.chatId ?? null,
        ts: parsed?.ts ?? null,
        question: r.question,
        answer: r.answer,
        status: st as ReflectionStatus,
      }
    })
  }

  // 记录一条沉淀的来源问答(chunk_id 对应 kb_chunks.id)。poller 沉淀后调用;默认 approved 直接入库。
  insertReflectionMeta(
    chunkId: number,
    channel: string,
    chatId: string,
    question: string,
    answer: string
  ): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO reflection_meta (chunk_id, channel, group_id, question, answer, status) VALUES (?, ?, ?, ?, ?, 'approved')"
      )
      .run(chunkId, channel, chatId, question, answer)
  }

  setReflectionStatus(chunkId: number, status: ReflectionStatus): boolean {
    // 无 meta 的压缩条目:补一行再更新
    const exists = this.db
      .prepare("SELECT 1 FROM reflection_meta WHERE chunk_id = ?")
      .get(chunkId)
    if (!exists) {
      this.db
        .prepare(
          "INSERT INTO reflection_meta (chunk_id, channel, group_id, question, answer, status) VALUES (?, 'qq', NULL, NULL, NULL, ?)"
        )
        .run(chunkId, status)
      return true
    }
    const info = this.db
      .prepare("UPDATE reflection_meta SET status = ? WHERE chunk_id = ?")
      .run(status, chunkId)
    return info.changes > 0
  }

  // 升格为正式文档:标 promoted;写文件+向量入库由 applyPromote / API 处理
  promoteReflection(
    chunkId: number
  ): { ok: boolean; content?: string; status?: ReflectionStatus } {
    const row = this.db
      .prepare(
        "SELECT content FROM kb_chunks WHERE id = ? AND doc = 'human-reflection'"
      )
      .get(chunkId) as { content: string } | undefined
    if (!row) return { ok: false }
    const meta = this.db
      .prepare("SELECT status FROM reflection_meta WHERE chunk_id = ?")
      .get(chunkId) as { status: string } | undefined
    const status = (
      meta?.status === "promoted" ||
      meta?.status === "rejected" ||
      meta?.status === "pending"
        ? meta.status
        : "approved"
    ) as ReflectionStatus
    if (status === "rejected") return { ok: false }
    return { ok: true, content: row.content, status }
  }

  // 最近 N 次整理记录(倒序),before/after 内容内联(解析 JSON)
  recentCompactions(limit: number): {
    id: number
    ts: number
    beforeCount: number
    afterCount: number
    before: string[]
    after: string[]
  }[] {
    const rows = this.db
      .prepare(
        "SELECT id, ts, before_count, after_count, before_json, after_json FROM reflect_compactions ORDER BY ts DESC LIMIT ?"
      )
      .all(limit) as {
      id: number
      ts: number
      before_count: number
      after_count: number
      before_json: string
      after_json: string
    }[]
    const parse = (s: string): string[] => {
      try {
        const v = JSON.parse(s)
        return Array.isArray(v) ? v : []
      } catch {
        return []
      }
    }
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      beforeCount: r.before_count,
      afterCount: r.after_count,
      before: parse(r.before_json),
      after: parse(r.after_json),
    }))
  }

  /** 去重:INSERT OR IGNORE into seen_messages(dedupe_key);返回是否已见过 */
  seenMessage(dedupeKey: string): boolean {
    const info = this.db
      .prepare("INSERT OR IGNORE INTO seen_messages (dedupe_key) VALUES (?)")
      .run(dedupeKey)
    return info.changes === 0
  }

  createTicket(sessionKey: string, summary: string): number {
    const info = this.db
      .prepare("INSERT INTO tickets (session_key, summary) VALUES (?, ?)")
      .run(sessionKey, summary)
    return Number(info.lastInsertRowid)
  }

  closeTicket(id: number): boolean {
    const info = this.db
      .prepare(
        "UPDATE tickets SET status = 'closed' WHERE id = ? AND status = 'open'"
      )
      .run(id)
    return info.changes > 0
  }

  closeOpenTicketsForSession(sessionKey: string): number {
    const info = this.db
      .prepare(
        "UPDATE tickets SET status = 'closed' WHERE session_key = ? AND status = 'open'"
      )
      .run(sessionKey)
    return info.changes
  }

  getTicket(
    id: number
  ):
    | {
        id: number
        sessionKey: string
        summary: string
        status: string
        createdAt: number
      }
    | undefined {
    const r = this.db
      .prepare(
        "SELECT id, session_key, summary, status, created_at FROM tickets WHERE id = ?"
      )
      .get(id) as
      | {
          id: number
          session_key: string
          summary: string
          status: string
          created_at: number
        }
      | undefined
    if (!r) return undefined
    return {
      id: r.id,
      sessionKey: r.session_key,
      summary: r.summary,
      status: r.status,
      createdAt: r.created_at,
    }
  }

  insertResolution(
    kind: string,
    opts: {
      sessionKey?: string
      channel?: string
      chatId?: string
      userId?: string
      detail?: string
    } = {}
  ): void {
    this.db
      .prepare(
        "INSERT INTO resolution_events (kind, session_key, channel, group_id, user_id, detail) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        kind,
        opts.sessionKey ?? null,
        opts.channel ?? null,
        opts.chatId ?? null,
        opts.userId ?? null,
        opts.detail ?? null
      )
  }

  // sinceTs 起各 kind 计数;用于日看板 / 自动解决率
  resolutionCounts(sinceTs: number): Record<string, number> {
    const rows = this.db
      .prepare(
        "SELECT kind, COUNT(*) AS n FROM resolution_events WHERE created_at >= ? GROUP BY kind"
      )
      .all(sinceTs) as { kind: string; n: number }[]
    const out: Record<string, number> = {}
    for (const r of rows) out[r.kind] = r.n
    return out
  }

  // 用量日持久化:增量累加
  addUsageDaily(
    day: string,
    site: string,
    d: {
      count: number
      cacheRead: number
      cacheCreation: number
      input: number
      output: number
      costUsd: number
    }
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
      .run(
        day,
        site,
        d.count,
        d.cacheRead,
        d.cacheCreation,
        d.input,
        d.output,
        d.costUsd
      )
  }

  usageDaily(day: string): {
    site: string
    count: number
    cacheRead: number
    cacheCreation: number
    input: number
    output: number
    costUsd: number
  }[] {
    const rows = this.db
      .prepare(
        "SELECT site, count, cache_read, cache_creation, input, output, cost_usd FROM usage_daily WHERE day = ?"
      )
      .all(day) as {
      site: string
      count: number
      cache_read: number
      cache_creation: number
      input: number
      output: number
      cost_usd: number
    }[]
    return rows.map((r) => ({
      site: r.site,
      count: r.count,
      cacheRead: r.cache_read,
      cacheCreation: r.cache_creation,
      input: r.input,
      output: r.output,
      costUsd: r.cost_usd,
    }))
  }

  usageDailyTotalCost(day: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(cost_usd), 0) AS n FROM usage_daily WHERE day = ?"
      )
      .get(day) as { n: number }
    return row.n
  }

  insertKbChunk(doc: string, content: string, source: string): number {
    const info = this.db
      .prepare("INSERT INTO kb_chunks (doc, content, source) VALUES (?, ?, ?)")
      .run(doc, content, source)
    return Number(info.lastInsertRowid)
  }

  insertKbVec(chunkId: number, embedding: Float32Array): void {
    this.db
      .prepare("INSERT INTO kb_vec (chunk_id, embedding) VALUES (?, ?)")
      .run(BigInt(chunkId), Buffer.from(embedding.buffer))
  }

  // 向量库预览:总量(chunks 与已建向量数,便于发现漏 embed 的孤儿 chunk)
  kbTotals(): { chunks: number; vecs: number } {
    const chunks = (
      this.db.prepare("SELECT COUNT(*) n FROM kb_chunks").get() as {
        n: number
      }
    ).n
    const vecs = (
      this.db.prepare("SELECT COUNT(*) n FROM kb_vec").get() as { n: number }
    ).n
    return { chunks, vecs }
  }

  // 按 doc 分组的 chunk 数,doc 升序(与文件列表同一相对路径标识)
  kbDocStats(): { doc: string; chunks: number }[] {
    return this.db
      .prepare(
        "SELECT doc, COUNT(*) chunks FROM kb_chunks GROUP BY doc ORDER BY doc"
      )
      .all() as { doc: string; chunks: number }[]
  }

  // 单 doc 的分块内容,按 id 升序(即入库/切分顺序)
  kbChunksByDoc(doc: string): { id: number; content: string }[] {
    return this.db
      .prepare("SELECT id, content FROM kb_chunks WHERE doc = ? ORDER BY id")
      .all(doc) as { id: number; content: string }[]
  }

  // 删文档对应的全部 chunk+vec(文件删除 / 重建前清理用)。返回删除的 chunk 数。
  deleteKbDoc(doc: string): number {
    return this.db.transaction(() => {
      const ids = (
        this.db
          .prepare("SELECT id FROM kb_chunks WHERE doc = ?")
          .all(doc) as { id: number }[]
      ).map((r) => r.id)
      if (!ids.length) return 0
      const ph = ids.map(() => "?").join(",")
      this.db.prepare(`DELETE FROM kb_vec WHERE chunk_id IN (${ph})`).run(...ids)
      const info = this.db
        .prepare(`DELETE FROM kb_chunks WHERE id IN (${ph})`)
        .run(...ids)
      return info.changes
    })()
  }

  // 重命名文档:同步更新 doc;source 若等于旧路径也一并改(文件入库时 source=路径)。
  renameKbDoc(from: string, to: string): number {
    const info = this.db
      .prepare(
        `UPDATE kb_chunks
         SET doc = ?,
             source = CASE WHEN source = ? THEN ? ELSE source END
         WHERE doc = ?`
      )
      .run(to, from, to, from)
    return info.changes
  }

  // 向量近邻检索。驳回/已升格的反思不参与命中:
  // - rejected:人工纠错须立刻从检索消失
  // - promoted:知识已固化到正式文档(promoted/*.md),避免与正式 chunk 重复占 top-k
  // 无 meta / 非反思文档一律视为可检索(沉淀默认 approved)。
  searchKb(query: Float32Array, k: number): KbHit[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.content, c.source, v.distance
         FROM kb_vec v
         JOIN kb_chunks c ON c.id = v.chunk_id
         LEFT JOIN reflection_meta m ON m.chunk_id = c.id
         WHERE v.embedding MATCH ? AND k = ?
           AND COALESCE(m.status, 'approved') NOT IN ('rejected', 'promoted')
         ORDER BY v.distance`
      )
      .all(Buffer.from(query.buffer), k) as KbHit[]
    return rows
  }

  // 只在基础文档(doc != human-reflection)里做向量近邻,供压缩整理取权威上下文。
  // vec0 KNN 混合反思与基础条目;反思聚集时前 N 名可能被反思占满,故逐步放大候选池
  // 直到凑够 k 条基础条目或达上限(2000),避免静默少取。
  searchBaseKb(query: Float32Array, k: number): KbHit[] {
    const buf = Buffer.from(query.buffer)
    const stmt = this.db.prepare(
      `SELECT c.id, c.content, c.source, v.distance
       FROM kb_vec v JOIN kb_chunks c ON c.id = v.chunk_id
       WHERE v.embedding MATCH ? AND k = ?
         AND c.doc != 'human-reflection'
       ORDER BY v.distance`
    )
    for (const cand of [k * 4, k * 16, 2000]) {
      const rows = stmt.all(buf, cand) as KbHit[]
      if (rows.length >= k || cand >= 2000) return rows.slice(0, k)
    }
    return []
  }

  // 整体替换反思库(压缩整理用):单事务只删“快照内”的 human-reflection 条目(按 id,不按 doc),
  // 再插入整理结果 —— 避免删掉压缩 await 期间 poller 并发新增的条目。
  // source 统一 human-reflection:qq:0:{ts}(chatId 0 = 已压缩,全局归属)。
  replaceReflectionEntries(
    oldIds: number[],
    entries: { content: string; embedding: Float32Array }[],
    sourceTs: number,
    beforeContents: string[] = [],
    afterContents: string[] = []
  ): void {
    this.db.transaction(() => {
      if (oldIds.length) {
        const ph = oldIds.map(() => "?").join(",")
        this.db
          .prepare(`DELETE FROM kb_vec WHERE chunk_id IN (${ph})`)
          .run(...oldIds)
        this.db
          .prepare(`DELETE FROM kb_chunks WHERE id IN (${ph})`)
          .run(...oldIds)
        // 删被替换 chunk 的来源 meta,避免孤儿(整理后条目 chatId=0、无 meta)
        this.db
          .prepare(`DELETE FROM reflection_meta WHERE chunk_id IN (${ph})`)
          .run(...oldIds)
      }
      for (const e of entries) {
        const id = this.insertKbChunk(
          "human-reflection",
          e.content,
          `human-reflection:qq:0:${sourceTs}`
        )
        this.insertKbVec(id, e.embedding)
      }
      this.db
        .prepare(
          "INSERT INTO reflect_compactions (ts, before_count, after_count, before_json, after_json) VALUES (?, ?, ?, ?, ?)"
        )
        .run(
          sourceTs,
          beforeContents.length,
          afterContents.length,
          JSON.stringify(beforeContents),
          JSON.stringify(afterContents)
        )
    })()
  }

  getConfigRow(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(key) as { value: string } | undefined
    return row?.value
  }

  setConfigRow(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, value)
  }

  countSessions(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM sessions")
      .get() as { n: number }
    return row.n
  }

  listSessions(): {
    key: string
    sessionId: string | null
    active: boolean
    humanMode: boolean
    humanSince: number | null
    lastQuestion: string | null
    updatedAt: number
  }[] {
    const rows = this.db
      .prepare(
        "SELECT key, session_id, resume_id, human_mode, human_since, last_question, updated_at FROM sessions ORDER BY updated_at DESC"
      )
      .all() as {
      key: string
      session_id: string | null
      resume_id: string | null
      human_mode: number
      human_since: number | null
      last_question: string | null
      updated_at: number
    }[]
    return rows.map((r) => ({
      key: r.key,
      sessionId: r.session_id,
      active: r.resume_id !== null, // 有续接指针 → 下条消息接续当前对话;否则将开新会话
      humanMode: !!r.human_mode,
      humanSince: r.human_since,
      lastQuestion: r.last_question,
      updatedAt: r.updated_at,
    }))
  }

  openTickets(): {
    id: number
    sessionKey: string
    summary: string
    createdAt: number
  }[] {
    const rows = this.db
      .prepare(
        "SELECT id, session_key, summary, created_at FROM tickets WHERE status = 'open' ORDER BY created_at DESC"
      )
      .all() as {
      id: number
      session_key: string
      summary: string
      created_at: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      sessionKey: r.session_key,
      summary: r.summary,
      createdAt: r.created_at,
    }))
  }

  listTickets(): {
    id: number
    sessionKey: string
    summary: string
    status: string
    createdAt: number
  }[] {
    const rows = this.db
      .prepare(
        "SELECT id, session_key, summary, status, created_at FROM tickets ORDER BY created_at DESC"
      )
      .all() as {
      id: number
      session_key: string
      summary: string
      status: string
      created_at: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      sessionKey: r.session_key,
      summary: r.summary,
      status: r.status,
      createdAt: r.created_at,
    }))
  }
}
