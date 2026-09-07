/** SQLite 查询投影：保留数据库列名，不对外充当业务对象。 */
export interface GroupMessageRow {
  user_id: string
  sender_role: string | null
  text: string
  created_at: number
}

export interface UserMessageRow {
  id: number
  text: string
  created_at: number
  message_id: string | null
}

export interface MemberMessageRow {
  user_id: string
  text: string
  created_at: number
  message_id: string | null
}

export interface ReflectionRow {
  id: number
  content: string
  source: string | null
  question: string | null
  answer: string | null
  status: string
}

export interface ReflectionSummaryRow {
  id: number
  content: string
  contentLen: number
  source: string | null
  question: string | null
  answer: string | null
  status: string
}

export interface CompactionSummaryRow {
  id: number
  ts: number
  before_count: number
  after_count: number
}

export interface CompactionRow {
  id: number
  ts: number
  before_count: number
  after_count: number
  before_json: string
  after_json: string
}

export interface OpenTicketRow {
  id: number
  session_key: string
  summary: string
  created_at: number
}

export interface TicketRow {
  id: number
  session_key: string
  summary: string
  status: string
  created_at: number
}

export interface SessionRow {
  key: string
  session_id: string | null
  resume_id: string | null
  human_mode: number
  human_since: number | null
  last_question: string | null
  updated_at: number
}

export interface ProactiveReplyRow {
  id: number
  channel: string
  group_id: string
  user_id: string
  question: string
  answer: string
  quality: string | null
  created_at: number
}

export interface DailyUsageRow {
  site: string
  count: number
  cache_read: number
  cache_creation: number
  input: number
  output: number
  cost_usd: number
}
