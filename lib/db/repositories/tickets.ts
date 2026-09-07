import { mapOpenTicket, mapTicket } from "../row-mappers.ts"
import type { TicketRow, OpenTicketRow } from "../rows.ts"
import type { Ticket, OpenTicket } from "../models.ts"
import type { SqliteContext } from "../context.ts"

/** 人工工单的创建、关闭与查询；会话状态由会话模块管理。 */
export class TicketsRepository {
  constructor(private readonly sql: SqliteContext) {}

  createTicket(sessionKey: string, summary: string): number {
    const info = this.sql
      .prepare("INSERT INTO tickets (session_key, summary) VALUES (?, ?)")
      .run(sessionKey, summary)
    return Number(info.lastInsertRowid)
  }

  closeTicket(id: number): boolean {
    const info = this.sql
      .prepare(
        "UPDATE tickets SET status = 'closed' WHERE id = ? AND status = 'open'"
      )
      .run(id)
    return info.changes > 0
  }

  closeOpenTicketsForSession(sessionKey: string): number {
    const info = this.sql
      .prepare(
        "UPDATE tickets SET status = 'closed' WHERE session_key = ? AND status = 'open'"
      )
      .run(sessionKey)
    return info.changes
  }

  getTicket(id: number): Ticket | undefined {
    const r = this.sql
      .prepare<TicketRow>(
        "SELECT id, session_key, summary, status, created_at FROM tickets WHERE id = ?"
      )
      .get(id)
    return r ? mapTicket(r) : undefined
  }

  openTickets(): OpenTicket[] {
    const rows = this.sql
      .prepare<OpenTicketRow>(
        "SELECT id, session_key, summary, created_at FROM tickets WHERE status = 'open' ORDER BY created_at DESC"
      )
      .all()
    return rows.map(mapOpenTicket)
  }

  listTickets(): Ticket[] {
    const rows = this.sql
      .prepare<TicketRow>(
        "SELECT id, session_key, summary, status, created_at FROM tickets ORDER BY created_at DESC"
      )
      .all()
    return rows.map(mapTicket)
  }
}
