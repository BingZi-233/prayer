import type { ProactiveReplyRow } from "../rows.ts"
import type { ProactiveReply, ChatActivity } from "../models.ts"
import type { SqliteContext } from "../context.ts"
import type { ConfigRepository } from "./config.ts"

/** 主动回复留痕、质量标记与扫描进度。 */
export class ProactiveRepository {
  constructor(
    private readonly sql: SqliteContext,
    private readonly config: ConfigRepository
  ) {}

  // proactive_replies:主动回复历史页(近期插话列表/按群计数)。窗口外计数随之收敛,
  // 该页是「近期活跃」视角,老数据无消费方
  pruneProactiveReplies(beforeTs: number): void {
    this.sql
      .prepare("DELETE FROM proactive_replies WHERE created_at < ?")
      .run(beforeTs)
  }

  // 主动兜底游标(每 chat 独立,已扫描到的时间戳),复用 config 表
  groupProactiveCursor(channel: string, chatId: string): number {
    return Number(
      this.config.getConfigRow(`proactive_cursor:${channel}:${chatId}`) ?? "0"
    )
  }

  setGroupProactiveCursor(channel: string, chatId: string, ts: number): void {
    this.config.setConfigRow(
      `proactive_cursor:${channel}:${chatId}`,
      String(ts)
    )
  }

  // 主动回复命中留痕:每次真正主动补位一句就记一行,供监控页看历史/次数。
  insertProactiveReply(
    channel: string,
    chatId: string,
    userId: string,
    question: string,
    answer: string,
    opts: { deliveryKey?: string; deliveryStatus?: string; deliveryExpected?: number } = {}
  ): number {
    const info = this.sql
      .prepare(
        "INSERT OR IGNORE INTO proactive_replies (channel, group_id, user_id, question, answer, delivery_key, delivery_status, delivery_expected) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(channel, chatId, userId, question, answer, opts.deliveryKey ?? null, opts.deliveryStatus ?? "sent", opts.deliveryExpected ?? null)
    return Number(info.lastInsertRowid)
  }

  setProactiveQuality(id: number, quality: "ok" | "bad"): boolean {
    const info = this.sql
      .prepare("UPDATE proactive_replies SET quality = ? WHERE id = ?")
      .run(quality, id)
    return info.changes > 0
  }

  // 最近主动回复(降序),监控页插话列表用
  proactiveReplies(limit: number): ProactiveReply[] {
    const rows = this.sql
      .prepare<ProactiveReplyRow>(
        "SELECT id, channel, group_id, user_id, question, answer, quality, created_at FROM proactive_replies ORDER BY id DESC LIMIT ?"
      )
      .all(limit)
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      chatId: r.group_id,
      userId: r.user_id,
      question: r.question,
      answer: r.answer,
      quality: r.quality === "ok" || r.quality === "bad" ? r.quality : null,
      ts: r.created_at,
    }))
  }

  // 每 chat 主动回复数 + 最近一条时间,监控页每群行用
  proactiveGroupCounts(): ChatActivity[] {
    return this.sql
      .prepare<{
        channel: string
        chatId: string
        count: number
        lastTs: number
      }>(
        `SELECT channel AS channel, group_id AS chatId, COUNT(*) AS count, MAX(created_at) AS lastTs
         FROM proactive_replies WHERE delivery_status = 'sent' GROUP BY channel, group_id`
      )
      .all()
  }

  // 主动回复总数
  proactiveTotalCount(): number {
    return this.sql
      .prepare<{
        n: number
      }>("SELECT COUNT(*) n FROM proactive_replies WHERE delivery_status = 'sent'")
      .get()!.n
  }

  proactiveBadCount(sinceTs?: number): number {
    if (sinceTs != null) {
      return this.sql
        .prepare<{ n: number }>(
          "SELECT COUNT(*) n FROM proactive_replies WHERE quality = 'bad' AND delivery_status = 'sent' AND created_at >= ?"
        )
        .get(sinceTs)!.n
    }
    return this.sql
      .prepare<{ n: number }>(
        "SELECT COUNT(*) n FROM proactive_replies WHERE quality = 'bad' AND delivery_status = 'sent'"
      )
      .get()!.n
  }
}
