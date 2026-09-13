import { mapGroupMessage } from "../row-mappers.ts"
import type {
  UserMessageRow,
  GroupMessageRow,
  MemberMessageRow,
} from "../rows.ts"
import type {
  UserMessage,
  GroupMessage,
  MemberMessage,
  ChatActivity,
} from "../models.ts"
import type { SqliteContext } from "../context.ts"
import type { ChatRef } from "../models.ts"

/** 群消息缓冲与入站去重；为主应答和后台任务提供统一时间窗。 */
export class MessagesRepository {
  constructor(private readonly sql: SqliteContext) {}

  // 群消息缓冲(被动反思用):落库。messageId 供主动回复引用原消息;缺省 → NULL(不引用)。
  // mentionedBot 标记 @bot 消息:主链路在处理,主动补位不拿它当候选(仍落库供反思/prior 看全量)。
  // OR IGNORE + (channel, group_id, message_id) 唯一索引:多实例/重推时同一消息只落一行(NULL 不去重)。
  bufferGroupMessage(
    channel: string,
    chatId: string,
    userId: string,
    senderRole: string | null,
    text: string,
    messageId?: string | null,
    mentionedBot?: boolean
  ): void {
    this.sql
      .prepare(
        "INSERT OR IGNORE INTO group_messages (channel, group_id, user_id, sender_role, text, message_id, mentioned_bot) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        channel,
        chatId,
        userId,
        senderRole,
        text,
        messageId ?? null,
        mentionedBot ? 1 : 0
      )
  }

  // 某用户在某群的最近非空消息(@ 前 prior 上下文用)。
  // 先 DESC 取 limit,再 reverse 为升序;同 created_at 按 id 稳定排序。
  // opts.sinceTs: 仅 created_at > sinceTs(通常取 priorSince);opts.excludeMessageId: 排除当前触发消息。
  recentUserGroupMessages(
    channel: string,
    chatId: string,
    userId: string,
    limit: number,
    opts?: { excludeMessageId?: string; sinceTs?: number }
  ): UserMessage[] {
    if (limit <= 0) return []
    const sinceTs = opts?.sinceTs ?? 0
    const exclude = opts?.excludeMessageId
    const rows = this.sql
      .prepare<UserMessageRow>(
        `SELECT id, text, created_at, message_id FROM group_messages
         WHERE channel = ? AND group_id = ? AND user_id = ?
           AND length(trim(text)) > 0
           AND created_at > ?
           AND (? IS NULL OR message_id IS NULL OR message_id != ?)
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(
        channel,
        chatId,
        userId,
        sinceTs,
        exclude ?? null,
        exclude ?? null,
        limit
      )
    return rows
      .map((r) => ({
        text: r.text,
        createdAt: r.created_at,
        messageId: r.message_id,
        id: r.id,
      }))
      .reverse()
  }

  // 上界 untilTs 前存在 owner/admin 发言的候选 chat,去重(每群游标另判 band)
  groupsWithAdminMessagesUpTo(untilTs: number): ChatRef[] {
    const rows = this.sql
      .prepare<{ channel: string; group_id: string }>(
        `SELECT DISTINCT channel, group_id FROM group_messages
         WHERE created_at <= ? AND sender_role IN ('owner','admin')
         ORDER BY channel, group_id`
      )
      .all(untilTs)
    return rows.map((r) => ({ channel: r.channel, chatId: r.group_id }))
  }

  // 某 chat (afterTs, untilTs] 内是否有 owner/admin 发言
  hasAdminMessageBetween(
    channel: string,
    chatId: string,
    afterTs: number,
    untilTs: number
  ): boolean {
    const row = this.sql
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
  ): GroupMessage[] {
    const rows = this.sql
      .prepare<GroupMessageRow>(
        `SELECT user_id, sender_role, text, created_at FROM group_messages
         WHERE channel = ? AND group_id = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(channel, chatId, sinceTs, limit)
    return rows.map(mapGroupMessage).reverse()
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
  ): GroupMessage[] {
    const pre = this.sql
      .prepare<GroupMessageRow>(
        `SELECT user_id, sender_role, text, created_at FROM group_messages
           WHERE channel = ? AND group_id = ? AND created_at <= ?
           ORDER BY created_at DESC LIMIT ?`
      )
      .all(channel, chatId, cursor, preLimit)
      .map(mapGroupMessage)
      .reverse()
    const post = this.sql
      .prepare<GroupMessageRow>(
        `SELECT user_id, sender_role, text, created_at FROM group_messages
           WHERE channel = ? AND group_id = ? AND created_at > ? AND created_at <= ?
           ORDER BY created_at ASC LIMIT ?`
      )
      .all(channel, chatId, cursor, nowTs, postLimit)
      .map(mapGroupMessage)
    return [...pre, ...post]
  }

  pruneGroupMessages(beforeTs: number): void {
    this.sql
      .prepare("DELETE FROM group_messages WHERE created_at < ?")
      .run(beforeTs)
  }

  // seen_messages:入站消息去重(OneBot 重推发生在秒级),7 天绰绰有余;此前永不清理
  pruneSeenMessages(beforeTs: number): void {
    this.sql
      .prepare("DELETE FROM seen_messages WHERE created_at < ?")
      .run(beforeTs)
  }

  // 某 chat (afterTs, untilTs] 内的非管理发言(member/NULL),升序。主动兜底候选原料。
  // 排除 @bot 消息:那归主链路处理,不作「无人应答」候选。
  groupMemberMessagesBetween(
    channel: string,
    chatId: string,
    afterTs: number,
    untilTs: number
  ): MemberMessage[] {
    const rows = this.sql
      .prepare<MemberMessageRow>(
        `SELECT id, user_id, text, created_at, message_id FROM group_messages
         WHERE channel = ? AND group_id = ? AND created_at > ? AND created_at <= ?
           AND (sender_role IS NULL OR sender_role NOT IN ('owner','admin'))
           AND mentioned_bot = 0
         ORDER BY created_at ASC`
      )
      .all(channel, chatId, afterTs, untilTs)
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      text: r.text,
      createdAt: r.created_at,
      messageId: r.message_id,
    }))
  }

  // 每 chat 缓冲消息量 + 最近一条时间(反思原料规模)
  groupMessageStats(): ChatActivity[] {
    return this.sql
      .prepare<{
        channel: string
        chatId: string
        count: number
        lastTs: number
      }>(
        `SELECT channel AS channel, group_id AS chatId, COUNT(*) AS count, MAX(created_at) AS lastTs
         FROM group_messages GROUP BY channel, group_id`
      )
      .all()
  }

  /** 去重:INSERT OR IGNORE into seen_messages(dedupe_key);返回是否已见过 */
  seenMessage(dedupeKey: string): boolean {
    const info = this.sql
      .prepare("INSERT OR IGNORE INTO seen_messages (dedupe_key) VALUES (?)")
      .run(dedupeKey)
    return info.changes === 0
  }
}
