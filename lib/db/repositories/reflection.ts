import { mapCompactionSummary, mapCompactionDetail } from "../row-mappers.ts"
import type {
  ReflectionRow,
  ReflectionSummaryRow,
  CompactionSummaryRow,
  CompactionRow,
} from "../rows.ts"
import type {
  ChatCursor,
  ReflectionEntry,
  ReflectionSummary,
  CompactionSummary,
  CompactionDetail,
} from "../models.ts"
import type { SqliteContext } from "../context.ts"
import type { ReflectionStatus } from "../models.ts"
import {
  mapReflectionRow,
  normalizeReflectionStatus,
} from "../reflection-mappers.ts"
import type { KnowledgeRepository } from "./knowledge.ts"
import type { ConfigRepository } from "./config.ts"

/** 反思来源、审核状态与整理记录；与知识库共享事务连接。 */
export class ReflectionRepository {
  constructor(
    private readonly sql: SqliteContext,
    private readonly config: ConfigRepository,
    private readonly knowledge: KnowledgeRepository
  ) {}

  // 反思游标(每 chat 独立,已处理到的时间戳),复用 config 表。
  groupReflectCursor(channel: string, chatId: string): number {
    return Number(
      this.config.getConfigRow(`reflect_cursor:${channel}:${chatId}`) ?? "0"
    )
  }

  setGroupReflectCursor(channel: string, chatId: string, ts: number): void {
    this.config.setConfigRow(`reflect_cursor:${channel}:${chatId}`, String(ts))
  }

  // 全局反思整理游标(上次整理完成时间戳),复用 config 表。
  compactAt(): number {
    return Number(this.config.getConfigRow("reflect_compact_at") ?? "0")
  }

  setCompactAt(ts: number): void {
    this.config.setConfigRow("reflect_compact_at", String(ts))
  }

  // 全局反思自动升格游标(上次升格评审完成时间戳)
  promoteAt(): number {
    return Number(this.config.getConfigRow("reflect_promote_at") ?? "0")
  }

  setPromoteAt(ts: number): void {
    this.config.setConfigRow("reflect_promote_at", String(ts))
  }

  // 每 chat 反思游标(config key = reflect_cursor:{channel}:{chatId})
  reflectCursors(): ChatCursor[] {
    const rows = this.sql
      .prepare<{ key: string; value: string }>(
        "SELECT key, value FROM config WHERE key LIKE 'reflect_cursor:%'"
      )
      .all()
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

  // 反思沉淀的知识条目(doc='human-reflection');source 见 parseReflectionSource。
  // LEFT JOIN reflection_meta 带出来源问答(整理后条目 chatId=0、无 meta → question/answer 为 null)
  // 无 meta / 未知 status 一律视为 approved(沉淀即入库,无需审核)
  reflectionEntries(): ReflectionEntry[] {
    const rows = this.sql
      .prepare<ReflectionRow>(
        `SELECT c.id, c.content, c.source, m.question, m.answer, COALESCE(m.status, 'approved') AS status
         FROM kb_chunks c LEFT JOIN reflection_meta m ON m.chunk_id = c.id
         WHERE c.doc = 'human-reflection' ORDER BY c.id DESC`
      )
      .all()
    return rows.map(mapReflectionRow)
  }

  // 沉淀条目列表摘要(反思专页 3s 轮询):content/question/answer 在 SQL 内截断,
  // 全文走 reflectionEntryDetail —— 全量全文曾把响应顶到 MB 级(compactions 同款事故)。
  // contentLen 供前端判断是否截断(展开后拉全文)。
  reflectionEntrySummaries(
    contentCap = 300,
    sourceCap = 200
  ): ReflectionSummary[] {
    const rows = this.sql
      .prepare<ReflectionSummaryRow>(
        `SELECT c.id, substr(c.content, 1, ?) AS content, length(c.content) AS contentLen,
              c.source, substr(m.question, 1, ?) AS question, substr(m.answer, 1, ?) AS answer,
              COALESCE(m.status, 'approved') AS status
         FROM kb_chunks c LEFT JOIN reflection_meta m ON m.chunk_id = c.id
         WHERE c.doc = 'human-reflection' ORDER BY c.id DESC`
      )
      .all(contentCap, sourceCap, sourceCap)
    return rows.map((r) => ({
      ...mapReflectionRow(r),
      contentLen: r.contentLen,
    }))
  }

  // 单条沉淀条目全文(前端展开时按需拉);不存在 → null
  reflectionEntryDetail(id: number): ReflectionEntry | null {
    const row = this.sql
      .prepare<ReflectionRow>(
        `SELECT c.id, c.content, c.source, m.question, m.answer, COALESCE(m.status, 'approved') AS status
         FROM kb_chunks c LEFT JOIN reflection_meta m ON m.chunk_id = c.id
         WHERE c.id = ? AND c.doc = 'human-reflection'`
      )
      .get(id)
    return row ? mapReflectionRow(row) : null
  }

  // 沉淀条数(overview 每 3s 轮询):SQL 计数,不再全量物化条目全文
  countReflectionEntries(): number {
    const row = this.sql
      .prepare<{ n: number }>(
        "SELECT COUNT(*) AS n FROM kb_chunks WHERE doc = 'human-reflection'"
      )
      .get()!
    return row.n
  }

  // 沉淀条目的 (id, source) 轻量清单:每 chat 沉淀计数等统计用,
  // 避免 reflectionEntries 的全文列被白白拉出(群活动页每 3s 轮询)
  reflectionSources(): { id: number; source: string | null }[] {
    return this.sql
      .prepare<{ id: number; source: string | null }>(
        "SELECT id, source FROM kb_chunks WHERE doc = 'human-reflection' ORDER BY id DESC"
      )
      .all()
  }

  // 记录一条沉淀的来源问答(chunk_id 对应 kb_chunks.id)。poller 沉淀后调用;默认 approved 直接入库。
  insertReflectionMeta(
    chunkId: number,
    channel: string,
    chatId: string,
    question: string,
    answer: string
  ): void {
    this.sql
      .prepare(
        "INSERT OR REPLACE INTO reflection_meta (chunk_id, channel, group_id, question, answer, status) VALUES (?, ?, ?, ?, ?, 'approved')"
      )
      .run(chunkId, channel, chatId, question, answer)
  }

  setReflectionStatus(chunkId: number, status: ReflectionStatus): boolean {
    // 无 meta 的压缩条目:补一行再更新
    const exists = this.sql
      .prepare("SELECT 1 FROM reflection_meta WHERE chunk_id = ?")
      .get(chunkId)
    if (!exists) {
      this.sql
        .prepare(
          "INSERT INTO reflection_meta (chunk_id, channel, group_id, question, answer, status) VALUES (?, 'qq', NULL, NULL, NULL, ?)"
        )
        .run(chunkId, status)
      return true
    }
    const info = this.sql
      .prepare("UPDATE reflection_meta SET status = ? WHERE chunk_id = ?")
      .run(status, chunkId)
    return info.changes > 0
  }

  // 升格为正式文档:标 promoted;写文件+向量入库由 applyPromote / API 处理
  promoteReflection(chunkId: number): {
    ok: boolean
    content?: string
    status?: ReflectionStatus
  } {
    const row = this.sql
      .prepare<{ content: string }>(
        "SELECT content FROM kb_chunks WHERE id = ? AND doc = 'human-reflection'"
      )
      .get(chunkId)
    if (!row) return { ok: false }
    const meta = this.sql
      .prepare<{ status: string }>(
        "SELECT status FROM reflection_meta WHERE chunk_id = ?"
      )
      .get(chunkId)
    const status = normalizeReflectionStatus(meta?.status)
    if (status === "rejected") return { ok: false }
    return { ok: true, content: row.content, status }
  }

  // 最近 N 次整理记录的摘要(倒序),不含 before/after 全文。
  // 反思专页每 3 秒轮询,每条记录的 before_json/after_json 是整批知识条目全文,
  // 30 条曾把响应顶到 8MB+ / 单请求 30~90s 把进程打死 → 列表只给计数,全文走 compactionDetail。
  recentCompactionSummaries(limit: number): CompactionSummary[] {
    const rows = this.sql
      .prepare<CompactionSummaryRow>(
        "SELECT id, ts, before_count, after_count FROM reflect_compactions ORDER BY ts DESC LIMIT ?"
      )
      .all(limit)
    return rows.map(mapCompactionSummary)
  }

  // 单条整理记录详情(含 before/after 全文);查不到返回 null。前端展开时按需拉取。
  compactionDetail(id: number): CompactionDetail | null {
    const r = this.sql
      .prepare<CompactionRow>(
        "SELECT id, ts, before_count, after_count, before_json, after_json FROM reflect_compactions WHERE id = ?"
      )
      .get(id)
    return r ? mapCompactionDetail(r) : null
  }

  // 最近 N 次整理记录(倒序),before/after 内容内联(解析 JSON)
  recentCompactions(limit: number): CompactionDetail[] {
    const rows = this.sql
      .prepare<CompactionRow>(
        "SELECT id, ts, before_count, after_count, before_json, after_json FROM reflect_compactions ORDER BY ts DESC LIMIT ?"
      )
      .all(limit)
    return rows.map(mapCompactionDetail)
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
    this.sql.transaction(() => {
      if (oldIds.length) {
        const ph = oldIds.map(() => "?").join(",")
        this.sql
          .prepare(`DELETE FROM kb_vec WHERE chunk_id IN (${ph})`)
          .run(...oldIds)
        this.sql
          .prepare(`DELETE FROM kb_chunks WHERE id IN (${ph})`)
          .run(...oldIds)
        // 删被替换 chunk 的来源 meta,避免孤儿(整理后条目 chatId=0、无 meta)
        this.sql
          .prepare(`DELETE FROM reflection_meta WHERE chunk_id IN (${ph})`)
          .run(...oldIds)
      }
      for (const e of entries) {
        const id = this.knowledge.insertKbChunk(
          "human-reflection",
          e.content,
          `human-reflection:qq:0:${sourceTs}`
        )
        this.knowledge.insertKbVec(id, e.embedding)
      }
      this.sql
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
    })
  }
}
