import type {
  GroupMessage,
  OpenTicket,
  Ticket,
  CompactionSummary,
  CompactionDetail,
} from "./models.ts"
import type {
  GroupMessageRow,
  OpenTicketRow,
  TicketRow,
  CompactionSummaryRow,
  CompactionRow,
} from "./rows.ts"
import { parseStringArray } from "./reflection-mappers.ts"

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

/** 高频列表只映射计数，避免将整批整理前后正文放进轮询响应。 */
export function mapCompactionSummary(
  row: CompactionSummaryRow
): CompactionSummary {
  return {
    id: row.id,
    ts: row.ts,
    beforeCount: row.before_count,
    afterCount: row.after_count,
  }
}

export function mapCompactionDetail(row: CompactionRow): CompactionDetail {
  return {
    ...mapCompactionSummary(row),
    before: parseStringArray(row.before_json),
    after: parseStringArray(row.after_json),
  }
}
