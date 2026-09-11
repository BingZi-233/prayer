import type { SessionRow } from "../rows.ts"
import type { SessionSummary } from "../models.ts"
import type { SqliteContext } from "../context.ts"

/** 会话状态与续接指针；不负责消息缓冲和工单生命周期。 */
export class SessionsRepository {
  constructor(private readonly sql: SqliteContext) {}

  // 记住会话:session_id(展示,网页读 transcript)与 resume_id(续接)同步写入
  setSessionId(key: string, sessionId: string): void {
    this.sql
      .prepare(
        `INSERT INTO sessions (key, session_id, resume_id) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id, resume_id = excluded.resume_id, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, sessionId, sessionId)
  }

  // 仅刷 updated_at,不动 session_id/resume_id。
  // 主管线 handle 入口调用:处理途中就让主动补位压制②看见「已接管」,堵
  // agent.run 窗口期(秒~数十秒)内同一消息被未答复轮询抢答双发。
  touchSession(key: string): void {
    this.sql
      .prepare(
        `INSERT INTO sessions (key, updated_at) VALUES (?, unixepoch('subsec')*1000)
         ON CONFLICT(key) DO UPDATE SET updated_at = unixepoch('subsec')*1000`
      )
      .run(key)
  }

  // 仅清 resume_id → 下条消息开全新 SDK session;保留 session_id 供网页仍能查看历史。
  // 同时推进 prior_since 纪元:此后 recentUserGroupMessages 不再回看边界前消息。
  clearResumeId(key: string): void {
    this.sql
      .prepare(
        `INSERT INTO sessions (key, resume_id, prior_since, updated_at)
         VALUES (?, NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000)
         ON CONFLICT(key) DO UPDATE SET
           resume_id = NULL,
           prior_since = unixepoch('subsec')*1000,
           updated_at = unixepoch('subsec')*1000`
      )
      .run(key)
  }

  // 一键清所有会话的 resume_id → 每个会话下条消息各自开全新对话;session_id 保留,网页历史仍可查。
  // 返回受影响(此前仍有 resume_id)的会话数,供后台提示。
  // 同时推进全部行的 prior_since 纪元(含本已无 resume 的行)。
  clearAllResumeIds(): number {
    return this.sql.transaction(() => {
      const info = this.sql
        .prepare(
          "UPDATE sessions SET resume_id = NULL, updated_at = unixepoch('subsec')*1000 WHERE resume_id IS NOT NULL"
        )
        .run()
      this.sql
        .prepare(
          "UPDATE sessions SET prior_since = unixepoch('subsec')*1000, updated_at = unixepoch('subsec')*1000"
        )
        .run()
      return info.changes
    })
  }

  getSessionId(key: string): string | undefined {
    const row = this.sql
      .prepare<{ session_id: string | null }>(
        "SELECT session_id FROM sessions WHERE key = ?"
      )
      .get(key)
    return row?.session_id ?? undefined
  }

  // 该会话 prior 上下文上界:clearResumeId 后推进;未设则为 0(无过滤)
  priorSince(key: string): number {
    const row = this.sql
      .prepare<{ prior_since: number | null }>(
        "SELECT prior_since FROM sessions WHERE key = ?"
      )
      .get(key)
    return row?.prior_since ?? 0
  }

  // 续接指针:reset 后为空 → Agent 不 resume,开新会话。
  // maxIdleMs > 0 时惰性过期:距上次活动(updated_at)超时则视为无 resume,下条消息开新会话
  // (不改库,session_id 仍在 → 网页可查历史);maxIdleMs <= 0 关闭过期。
  getResumeId(key: string, maxIdleMs = 0): string | undefined {
    const row = this.sql
      .prepare<{ resume_id: string | null }>(
        `SELECT resume_id FROM sessions
         WHERE key = ? AND (? <= 0 OR updated_at >= unixepoch('subsec') * 1000 - ?)`
      )
      .get(key, maxIdleMs, maxIdleMs)
    return row?.resume_id ?? undefined
  }

  isHumanMode(key: string): boolean {
    const row = this.sql
      .prepare<{ human_mode: number }>(
        "SELECT human_mode FROM sessions WHERE key = ?"
      )
      .get(key)
    return !!row?.human_mode
  }

  setHumanMode(key: string, on: boolean): void {
    const now = Date.now()
    this.sql
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
    this.sql
      .prepare(
        `INSERT INTO sessions (key, last_question, updated_at) VALUES (?, ?, unixepoch('subsec')*1000)
         ON CONFLICT(key) DO UPDATE SET last_question = excluded.last_question, updated_at = excluded.updated_at`
      )
      .run(key, q)
  }

  // 单行取 last_question(handoff 热路径):替代 listSessions().find 全表拉行找一行
  lastQuestion(key: string): string | null {
    const row = this.sql
      .prepare<{ last_question: string | null }>(
        "SELECT last_question FROM sessions WHERE key = ?"
      )
      .get(key)
    return row?.last_question ?? null
  }

  // 超时扫描:human_mode=1 且 human_since 早于 cutoff 的会话
  expiredHumanSessions(cutoffMs: number): string[] {
    const rows = this.sql
      .prepare<{ key: string }>(
        `SELECT key FROM sessions WHERE human_mode = 1 AND human_since IS NOT NULL AND human_since < ?`
      )
      .all(cutoffMs)
    return rows.map((r) => r.key)
  }

  // 会话最后活动时间(主链路 @处理 / 兜底都会 setSessionId 刷新)。主动兜底压制②用:
  // 该值 > 问题 ts → 该用户已被主链路处理或已兜底过 → 不重复插话。
  sessionUpdatedAt(key: string): number | undefined {
    const row = this.sql
      .prepare<{ updated_at: number }>(
        "SELECT updated_at FROM sessions WHERE key = ?"
      )
      .get(key)
    return row?.updated_at
  }

  countSessions(): number {
    const row = this.sql
      .prepare<{
        n: number
      }>("SELECT COUNT(*) AS n FROM sessions")
      .get()!
    return row.n
  }

  // human_mode=1 的会话数:overview / runtime.getStatus 轮询用,SQL 计数替代全表拉行过滤
  countHumanSessions(): number {
    const row = this.sql
      .prepare<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sessions WHERE human_mode = 1"
      )
      .get()!
    return row.n
  }

  listSessions(
    maxIdleMs = 5 * 60_000,
    now = Date.now(),
    // >0 时截断:会话表随(群,用户)只增不减,管理页虚拟滚动用不到全量历史
    limit = 0
  ): SessionSummary[] {
    const rows = this.sql
      .prepare<SessionRow>(
        "SELECT key, session_id, resume_id, human_mode, human_since, last_question, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?"
      )
      .all(limit > 0 ? limit : -1)
    return rows.map((r) => ({
      key: r.key,
      sessionId: r.session_id,
      // 活跃表示仍可在空闲窗口内续接，不能只按历史 resume_id 判断。
      active:
        r.resume_id !== null &&
        (maxIdleMs <= 0 || r.updated_at >= now - maxIdleMs),
      humanMode: !!r.human_mode,
      humanSince: r.human_since,
      lastQuestion: r.last_question,
      updatedAt: r.updated_at,
    }))
  }
}
