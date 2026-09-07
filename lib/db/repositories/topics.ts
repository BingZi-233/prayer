import type { QuestionTopic, TopicRanking, ChatCursor } from "../models.ts"
import type { SqliteContext } from "../context.ts"
import type { ChatRef } from "../models.ts"
import type { ConfigRepository } from "./config.ts"

/** 问题主题、出现记录与排行游标；批量归类由调用方包在事务中。 */
export class TopicsRepository {
  constructor(
    private readonly sql: SqliteContext,
    private readonly config: ConfigRepository
  ) {}

  // ── 问题排行榜 ──────────────────────────────────────────
  // 主题目录:同名(精确)原子复用(唯一索引 idx_qt_title 兜底并发),返回主题 id。
  // 近义归并由 poller 侧 textNearlySame 处理。
  insertQuestionTopic(title: string, now: number): number {
    const row = this.sql
      .prepare<{ id: number }>(
        `INSERT INTO question_topics (title, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(title) DO UPDATE SET updated_at = excluded.updated_at
       RETURNING id`
      )
      .get(title, now, now)!
    return row.id
  }

  insertQuestionOccurrence(
    topicId: number,
    channel: string,
    chatId: string,
    userId: string,
    text: string,
    msgTs: number
  ): void {
    this.sql
      .prepare(
        "INSERT INTO question_occurrences (topic_id, channel, group_id, user_id, text, msg_ts) VALUES (?,?,?,?,?,?)"
      )
      .run(topicId, channel, chatId, userId, text, msgTs)
  }

  // 主题被再次命中时刷新活跃时间,保证热门主题留在 questionTopics 前排(喂 LLM 归并用)
  touchQuestionTopic(id: number, now: number): void {
    this.sql
      .prepare("UPDATE question_topics SET updated_at = ? WHERE id = ?")
      .run(now, id)
  }

  // 现有主题清单(供 poller 喂 LLM 与近义归并),按最近活跃降序
  questionTopics(limit = 500): QuestionTopic[] {
    return this.sql
      .prepare<{ id: number; title: string }>(
        "SELECT id, title FROM question_topics ORDER BY updated_at DESC LIMIT ?"
      )
      .all(limit)
  }

  // 每 chat 问题排行游标(config key = topic_cursor:{channel}:{chatId})
  topicCursor(channel: string, chatId: string): number {
    return Number(
      this.config.getConfigRow(`topic_cursor:${channel}:${chatId}`) ?? "0"
    )
  }

  setTopicCursor(channel: string, chatId: string, ts: number): void {
    this.config.setConfigRow(`topic_cursor:${channel}:${chatId}`, String(ts))
  }

  // 时间窗排行:msg_ts >= sinceTs 的归属按主题计数,降序。sinceTs=0 即全部。
  rankingByWindow(sinceTs: number): TopicRanking[] {
    return this.sql
      .prepare<{
        id: number
        title: string
        count: number
        lastTs: number
      }>(
        `SELECT t.id AS id, t.title AS title, COUNT(o.id) AS count, MAX(o.msg_ts) AS lastTs
         FROM question_occurrences o
         JOIN question_topics t ON t.id = o.topic_id
         WHERE o.msg_ts >= ?
         GROUP BY t.id
         ORDER BY count DESC, lastTs DESC`
      )
      .all(sinceTs)
  }

  // 某主题窗口内代表问题样例,按最近降序。按 text 去重(同句重复发/转发只展示一次,计数不受影响)。
  topicSamples(topicId: number, limit: number, sinceTs = 0): string[] {
    const rows = this.sql
      .prepare<{ text: string; ts: number }>(
        `SELECT text, MAX(msg_ts) AS ts FROM question_occurrences
         WHERE topic_id = ? AND msg_ts >= ?
         GROUP BY text
         ORDER BY ts DESC LIMIT ?`
      )
      .all(topicId, sinceTs, limit)
    return rows.map((r) => r.text)
  }

  // 生效 chat 中 topic 游标的最小值(忽略从未处理过的 0,避免恒卡 prune)。
  // 无任何 >0 游标 → MAX_SAFE_INTEGER(prune 不受 topic 侧约束)。
  // 接受 {channel, chatId}[] 或历史 number[](视为 qq 群号,Phase 0 兼容)。
  // 全部 topic 游标(config key = topic_cursor:{channel}:{chatId}),一条 LIKE 查完
  topicCursors(): ChatCursor[] {
    const rows = this.sql
      .prepare<{ key: string; value: string }>(
        "SELECT key, value FROM config WHERE key LIKE 'topic_cursor:%'"
      )
      .all()
    const out: { channel: string; chatId: string; cursor: number }[] = []
    for (const r of rows) {
      const rest = r.key.slice("topic_cursor:".length)
      const parts = rest.split(":")
      if (parts.length < 2) continue
      out.push({
        channel: parts[0],
        chatId: parts.slice(1).join(":"),
        cursor: Number(r.value),
      })
    }
    return out
  }

  // 生效 chat 中 topic 游标的最小值(忽略从未处理过的 0,避免恒卡 prune)。
  // 无任何 >0 游标 → MAX_SAFE_INTEGER(prune 不受 topic 侧约束)。
  // 接受 {channel, chatId}[] 或历史 number[](视为 qq 群号,Phase 0 兼容)。
  // 一条 LIKE 批量取全部游标后在 JS 过滤(此前每 chat 一次 config 查询)。
  minTopicCursor(enabled: ChatRef[] | number[] | string[]): number {
    const keys = new Set<string>()
    for (const g of enabled) {
      if (typeof g === "number") {
        keys.add(`qq:${g}`)
        continue
      }
      if (typeof g === "string") {
        // "qq:100" 或裸 "100"
        const m = /^([a-z]+):(.+)$/.exec(g)
        keys.add(m ? `${m[1]}:${m[2]}` : `qq:${g}`)
        continue
      }
      keys.add(`${g.channel}:${g.chatId}`)
    }
    let min = Number.MAX_SAFE_INTEGER
    for (const c of this.topicCursors()) {
      if (!keys.has(`${c.channel}:${c.chatId}`)) continue
      if (c.cursor > 0 && c.cursor < min) min = c.cursor
    }
    return min
  }
}
