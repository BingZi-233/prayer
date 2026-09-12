import type { DailyUsageRow } from "../rows.ts"
import type {
  DailyUsage,
  DailyToolUsage,
  UsageTotals,
  ToolUsage,
} from "../models.ts"
import type { SqliteContext } from "../context.ts"

/** 处理结果、模型用量与工具调用的增量统计。 */
export class StatisticsRepository {
  constructor(private readonly sql: SqliteContext) {}
  markDelivery(key: string, status: "pending" | "sent" | "failed", error?: string, at?: number, sentChunks?: number): void {
    const finalStatus = status === "sent" && (sentChunks == null || sentChunks > 0) ? "sent" : status
    this.sql.prepare("UPDATE resolution_events SET delivery_status=?, last_error=?, delivered_at=? WHERE delivery_key=?").run(finalStatus, error ?? null, at ?? Date.now(), key)
    this.sql.prepare("UPDATE proactive_replies SET delivery_status=?, last_error=?, delivered_at=? WHERE delivery_key=?").run(finalStatus, error ?? null, at ?? Date.now(), key)
  }
  planDelivery(key: string, expected: number): void {
    this.sql.prepare("UPDATE resolution_events SET delivery_expected=?, delivery_status='pending' WHERE delivery_key=?").run(expected, key)
    this.sql.prepare("UPDATE proactive_replies SET delivery_expected=?, delivery_status='pending' WHERE delivery_key=?").run(expected, key)
  }
  deliveryExpected(key: string): number | undefined {
    const a = this.sql.prepare<{delivery_expected:number|null}>("SELECT delivery_expected FROM resolution_events WHERE delivery_key=? LIMIT 1").get(key)
    const b = this.sql.prepare<{delivery_expected:number|null}>("SELECT delivery_expected FROM proactive_replies WHERE delivery_key=? LIMIT 1").get(key)
    return a?.delivery_expected ?? b?.delivery_expected ?? undefined
  }

  // ── 数据保留 prune(随反思循环节奏跑;v6 索引保证按 created_at seek)──
  // resolution_events:每条消息 +1(含 ack),只服务「今日 0 点起」的看板计数
  pruneResolutionEvents(beforeTs: number): void {
    this.sql
      .prepare("DELETE FROM resolution_events WHERE created_at < ?")
      .run(beforeTs)
  }

  insertResolution(
    kind: string,
    opts: {
      sessionKey?: string
      channel?: string
      chatId?: string
      userId?: string
      detail?: string
      deliveryKey?: string
      deliveryStatus?: string
      deliveryExpected?: number
    } = {}
  ): void {
    this.sql
      .prepare(
        "INSERT INTO resolution_events (kind, session_key, channel, group_id, user_id, detail, delivery_key, delivery_status, delivery_expected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        kind,
        opts.sessionKey ?? null,
        opts.channel ?? null,
        opts.chatId ?? null,
        opts.userId ?? null,
        opts.detail ?? null, opts.deliveryKey ?? null, opts.deliveryStatus ?? "sent", opts.deliveryExpected ?? null
      )
  }

  // sinceTs 起各 kind 计数;用于日看板 / 自动解决率
  resolutionCounts(sinceTs: number): Record<string, number> {
    const rows = this.sql
      .prepare<{ kind: string; n: number }>(
        "SELECT kind, COUNT(*) AS n FROM resolution_events WHERE created_at >= ? AND (kind NOT IN ('auto','proactive') OR delivery_status='sent') GROUP BY kind"
      )
      .all(sinceTs)
    const out: Record<string, number> = {}
    for (const r of rows) out[r.kind] = r.n
    return out
  }

  // 用量日持久化:增量累加
  addUsageDaily(day: string, site: string, d: UsageTotals): void {
    this.sql
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

  usageDaily(day: string): DailyUsage[] {
    const rows = this.sql
      .prepare<DailyUsageRow>(
        "SELECT site, count, cache_read, cache_creation, input, output, cost_usd FROM usage_daily WHERE day = ?"
      )
      .all(day)
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

  // 工具调用日持久化:整个 run 的若干行一次事务写入,增量累加
  addToolStatsDaily(day: string, site: string, rows: ToolUsage[]): void {
    if (!rows.length) return
    const stmt = this.sql.prepare(
      `INSERT INTO tool_stats_daily (day, site, tool, runs, calls)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day, site, tool) DO UPDATE SET
         runs = runs + excluded.runs,
         calls = calls + excluded.calls`
    )
    this.sql.transaction(() => {
      for (const r of rows) stmt.run(day, site, r.tool, r.runs, r.calls)
    })
  }

  toolStatsDaily(day: string): DailyToolUsage[] {
    return this.sql
      .prepare<{ site: string; tool: string; runs: number; calls: number }>(
        "SELECT site, tool, runs, calls FROM tool_stats_daily WHERE day = ? ORDER BY site, calls DESC"
      )
      .all(day)
  }

  usageDailyTotalCost(day: string): number {
    const row = this.sql
      .prepare<{ n: number }>(
        "SELECT COALESCE(SUM(cost_usd), 0) AS n FROM usage_daily WHERE day = ?"
      )
      .get(day)!
    return row.n
  }
}
