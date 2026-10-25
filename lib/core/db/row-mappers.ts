import type { GroupMessage, OpenTicket, Ticket } from "./models.ts"
import type { GroupMessageRow, OpenTicketRow, TicketRow } from "./rows.ts"

/** 消息窗口共用列名转换，保持普通窗口和反思窗口的返回形状一致。 */
export function mapGroupMessage(row: GroupMessageRow): GroupMessage {
  return {
    userId: row.user_id,
    senderRole: row.sender_role,
    text: row.text,
    createdAt: row.created_at,
  }
}

export function mapOpenTicket(row: OpenTicketRow): OpenTicket {
  return {
    id: row.id,
    sessionKey: row.session_key,
    summary: row.summary,
    createdAt: row.created_at,
  }
}

export function mapTicket(row: TicketRow): Ticket {
  return { ...mapOpenTicket(row), status: row.status }
}
