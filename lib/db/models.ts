/** 数据访问层的业务返回类型；数据库原始列类型留在各领域模块中。 */
export interface KbHit {
  id: number
  content: string
  source: string | null
  distance: number
}

export type ProactiveQuality = "ok" | "bad" | null
export type ReflectionStatus = "pending" | "approved" | "rejected" | "promoted"

export interface ChatRef {
  channel: string
  chatId: string
}

/** 最近消息的公共内容字段；时间均为毫秒时间戳。 */
export interface GroupMessage {
  userId: string
  senderRole: string | null
  text: string
  createdAt: number
}
export interface UserMessage {
  text: string
  createdAt: number
  messageId: string | null
  id: number
}
export interface MemberMessage {
  userId: string
  text: string
  createdAt: number
  messageId: string | null
}
export interface ChatActivity extends ChatRef {
  count: number
  lastTs: number
}
export interface ChatCursor extends ChatRef {
  cursor: number
}
export interface ReflectionEntry {
  id: number
  content: string
  channel: string | null
  chatId: string | null
  ts: number | null
  question: string | null
  answer: string | null
  status: ReflectionStatus
}
export interface ReflectionSummary extends ReflectionEntry {
  contentLen: number
}
export interface CompactionSummary {
  id: number
  ts: number
  beforeCount: number
  afterCount: number
}
export interface CompactionDetail extends CompactionSummary {
  before: string[]
  after: string[]
}
export interface ProactiveReply extends ChatRef {
  id: number
  userId: string
  question: string
  answer: string
  quality: ProactiveQuality
  ts: number
}
export interface QuestionTopic {
  id: number
  title: string
}
export interface TopicRanking extends QuestionTopic {
  count: number
  lastTs: number
}
export interface UsageTotals {
  count: number
  cacheRead: number
  cacheCreation: number
  input: number
  output: number
  costUsd: number
}
export interface DailyUsage extends UsageTotals {
  site: string
}
export interface ToolUsage {
  tool: string
  runs: number
  calls: number
}
export interface DailyToolUsage extends ToolUsage {
  site: string
}
export interface SessionSummary {
  key: string
  sessionId: string | null
  active: boolean
  humanMode: boolean
  humanSince: number | null
  lastQuestion: string | null
  updatedAt: number
}
export interface OpenTicket {
  id: number
  sessionKey: string
  summary: string
  createdAt: number
}
export interface Ticket extends OpenTicket {
  status: string
}
