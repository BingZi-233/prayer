import type Database from "better-sqlite3"
import { SqliteContext } from "./context.ts"
import { SessionsRepository } from "./repositories/sessions.ts"
import { MessagesRepository } from "./repositories/messages.ts"
import { KnowledgeRepository } from "./repositories/knowledge.ts"
import { ReflectionRepository } from "./repositories/reflection.ts"
import { ProactiveRepository } from "./repositories/proactive.ts"
import { TopicsRepository } from "./repositories/topics.ts"
import { StatisticsRepository } from "./repositories/statistics.ts"
import { TicketsRepository } from "./repositories/tickets.ts"
import { ConfigRepository } from "./repositories/config.ts"

export type {
  KbHit,
  ProactiveQuality,
  ReflectionStatus,
  ChatRef,
} from "./models.ts"
export { parseReflectionSource } from "./reflection-mappers.ts"

/**
 * 兼容入口：旧调用方继续使用 repo.method()，新代码可依赖具体领域仓储。
 * 所有领域共享同一连接与语句缓存，跨领域事务因此仍是一个 SQLite 事务。
 * 连接由调用方持有和关闭，仓储不自行打开连接或执行数据库迁移。
 */
export class Repo {
  private readonly sql: SqliteContext
  readonly sessions: SessionsRepository
  readonly messages: MessagesRepository
  readonly knowledge: KnowledgeRepository
  readonly reflection: ReflectionRepository
  readonly proactive: ProactiveRepository
  readonly topics: TopicsRepository
  readonly statistics: StatisticsRepository
  readonly tickets: TicketsRepository
  readonly config: ConfigRepository

  constructor(private readonly db: Database.Database) {
    this.sql = new SqliteContext(db)
    this.config = new ConfigRepository(this.sql)
    this.knowledge = new KnowledgeRepository(this.sql)
    this.sessions = new SessionsRepository(this.sql)
    this.messages = new MessagesRepository(this.sql)
    this.reflection = new ReflectionRepository(
      this.sql,
      this.config,
      this.knowledge
    )
    this.proactive = new ProactiveRepository(this.sql, this.config)
    this.topics = new TopicsRepository(this.sql, this.config)
    this.statistics = new StatisticsRepository(this.sql)
    this.tickets = new TicketsRepository(this.sql)
  }

  /** 回调必须同步；异步计算和文件 IO 应在事务前完成。 */
  transaction<T>(fn: () => T): T {
    return this.sql.transaction(fn)
  }

  // 会话状态与续接指针；不负责消息缓冲和工单生命周期。
  setSessionId(...args: Parameters<SessionsRepository["setSessionId"]>) {
    return this.sessions.setSessionId(...args)
  }
  touchSession(...args: Parameters<SessionsRepository["touchSession"]>) {
    return this.sessions.touchSession(...args)
  }
  clearResumeId(...args: Parameters<SessionsRepository["clearResumeId"]>) {
    return this.sessions.clearResumeId(...args)
  }
  clearAllResumeIds(
    ...args: Parameters<SessionsRepository["clearAllResumeIds"]>
  ) {
    return this.sessions.clearAllResumeIds(...args)
  }
  getSessionId(...args: Parameters<SessionsRepository["getSessionId"]>) {
    return this.sessions.getSessionId(...args)
  }
  priorSince(...args: Parameters<SessionsRepository["priorSince"]>) {
    return this.sessions.priorSince(...args)
  }
  getResumeId(...args: Parameters<SessionsRepository["getResumeId"]>) {
    return this.sessions.getResumeId(...args)
  }
  isHumanMode(...args: Parameters<SessionsRepository["isHumanMode"]>) {
    return this.sessions.isHumanMode(...args)
  }
  setHumanMode(...args: Parameters<SessionsRepository["setHumanMode"]>) {
    return this.sessions.setHumanMode(...args)
  }
  setLastQuestion(...args: Parameters<SessionsRepository["setLastQuestion"]>) {
    return this.sessions.setLastQuestion(...args)
  }
  lastQuestion(...args: Parameters<SessionsRepository["lastQuestion"]>) {
    return this.sessions.lastQuestion(...args)
  }
  expiredHumanSessions(
    ...args: Parameters<SessionsRepository["expiredHumanSessions"]>
  ) {
    return this.sessions.expiredHumanSessions(...args)
  }
  sessionUpdatedAt(
    ...args: Parameters<SessionsRepository["sessionUpdatedAt"]>
  ) {
    return this.sessions.sessionUpdatedAt(...args)
  }
  countSessions(...args: Parameters<SessionsRepository["countSessions"]>) {
    return this.sessions.countSessions(...args)
  }
  countHumanSessions(
    ...args: Parameters<SessionsRepository["countHumanSessions"]>
  ) {
    return this.sessions.countHumanSessions(...args)
  }
  listSessions(...args: Parameters<SessionsRepository["listSessions"]>) {
    return this.sessions.listSessions(...args)
  }

  // 群消息缓冲与入站去重；为主应答和后台任务提供统一时间窗。
  bufferGroupMessage(
    ...args: Parameters<MessagesRepository["bufferGroupMessage"]>
  ) {
    return this.messages.bufferGroupMessage(...args)
  }
  recentUserGroupMessages(
    ...args: Parameters<MessagesRepository["recentUserGroupMessages"]>
  ) {
    return this.messages.recentUserGroupMessages(...args)
  }
  groupsWithAdminMessagesUpTo(
    ...args: Parameters<MessagesRepository["groupsWithAdminMessagesUpTo"]>
  ) {
    return this.messages.groupsWithAdminMessagesUpTo(...args)
  }
  hasAdminMessageBetween(
    ...args: Parameters<MessagesRepository["hasAdminMessageBetween"]>
  ) {
    return this.messages.hasAdminMessageBetween(...args)
  }
  groupMessageWindow(
    ...args: Parameters<MessagesRepository["groupMessageWindow"]>
  ) {
    return this.messages.groupMessageWindow(...args)
  }
  groupReflectionWindow(
    ...args: Parameters<MessagesRepository["groupReflectionWindow"]>
  ) {
    return this.messages.groupReflectionWindow(...args)
  }
  pruneGroupMessages(
    ...args: Parameters<MessagesRepository["pruneGroupMessages"]>
  ) {
    return this.messages.pruneGroupMessages(...args)
  }
  pruneSeenMessages(
    ...args: Parameters<MessagesRepository["pruneSeenMessages"]>
  ) {
    return this.messages.pruneSeenMessages(...args)
  }
  groupMemberMessagesBetween(
    ...args: Parameters<MessagesRepository["groupMemberMessagesBetween"]>
  ) {
    return this.messages.groupMemberMessagesBetween(...args)
  }
  groupMessageStats(
    ...args: Parameters<MessagesRepository["groupMessageStats"]>
  ) {
    return this.messages.groupMessageStats(...args)
  }
  seenMessage(...args: Parameters<MessagesRepository["seenMessage"]>) {
    return this.messages.seenMessage(...args)
  }

  // 知识分块和向量的物理存储；删除时维护关联数据的一致性。
  insertKbEntry(...args: Parameters<KnowledgeRepository["insertKbEntry"]>) {
    return this.knowledge.insertKbEntry(...args)
  }
  insertKbChunk(...args: Parameters<KnowledgeRepository["insertKbChunk"]>) {
    return this.knowledge.insertKbChunk(...args)
  }
  insertKbVec(...args: Parameters<KnowledgeRepository["insertKbVec"]>) {
    return this.knowledge.insertKbVec(...args)
  }
  kbTotals(...args: Parameters<KnowledgeRepository["kbTotals"]>) {
    return this.knowledge.kbTotals(...args)
  }
  kbDocStats(...args: Parameters<KnowledgeRepository["kbDocStats"]>) {
    return this.knowledge.kbDocStats(...args)
  }
  kbChunksByDoc(...args: Parameters<KnowledgeRepository["kbChunksByDoc"]>) {
    return this.knowledge.kbChunksByDoc(...args)
  }
  deleteKbDoc(...args: Parameters<KnowledgeRepository["deleteKbDoc"]>) {
    return this.knowledge.deleteKbDoc(...args)
  }
  deleteKbChunk(...args: Parameters<KnowledgeRepository["deleteKbChunk"]>) {
    return this.knowledge.deleteKbChunk(...args)
  }
  renameKbDoc(...args: Parameters<KnowledgeRepository["renameKbDoc"]>) {
    return this.knowledge.renameKbDoc(...args)
  }
  searchKb(...args: Parameters<KnowledgeRepository["searchKb"]>) {
    return this.knowledge.searchKb(...args)
  }
  searchBaseKb(...args: Parameters<KnowledgeRepository["searchBaseKb"]>) {
    return this.knowledge.searchBaseKb(...args)
  }

  // 反思来源、审核状态与整理记录；与知识库共享事务连接。
  groupReflectCursor(
    ...args: Parameters<ReflectionRepository["groupReflectCursor"]>
  ) {
    return this.reflection.groupReflectCursor(...args)
  }
  setGroupReflectCursor(
    ...args: Parameters<ReflectionRepository["setGroupReflectCursor"]>
  ) {
    return this.reflection.setGroupReflectCursor(...args)
  }
  compactAt(...args: Parameters<ReflectionRepository["compactAt"]>) {
    return this.reflection.compactAt(...args)
  }
  setCompactAt(...args: Parameters<ReflectionRepository["setCompactAt"]>) {
    return this.reflection.setCompactAt(...args)
  }
  promoteAt(...args: Parameters<ReflectionRepository["promoteAt"]>) {
    return this.reflection.promoteAt(...args)
  }
  setPromoteAt(...args: Parameters<ReflectionRepository["setPromoteAt"]>) {
    return this.reflection.setPromoteAt(...args)
  }
  reflectCursors(...args: Parameters<ReflectionRepository["reflectCursors"]>) {
    return this.reflection.reflectCursors(...args)
  }
  reflectionEntries(
    ...args: Parameters<ReflectionRepository["reflectionEntries"]>
  ) {
    return this.reflection.reflectionEntries(...args)
  }
  reflectionEntrySummaries(
    ...args: Parameters<ReflectionRepository["reflectionEntrySummaries"]>
  ) {
    return this.reflection.reflectionEntrySummaries(...args)
  }
  reflectionEntryDetail(
    ...args: Parameters<ReflectionRepository["reflectionEntryDetail"]>
  ) {
    return this.reflection.reflectionEntryDetail(...args)
  }
  countReflectionEntries(
    ...args: Parameters<ReflectionRepository["countReflectionEntries"]>
  ) {
    return this.reflection.countReflectionEntries(...args)
  }
  reflectionSources(
    ...args: Parameters<ReflectionRepository["reflectionSources"]>
  ) {
    return this.reflection.reflectionSources(...args)
  }
  insertReflectionMeta(
    ...args: Parameters<ReflectionRepository["insertReflectionMeta"]>
  ) {
    return this.reflection.insertReflectionMeta(...args)
  }
  setReflectionStatus(
    ...args: Parameters<ReflectionRepository["setReflectionStatus"]>
  ) {
    return this.reflection.setReflectionStatus(...args)
  }
  promoteReflection(
    ...args: Parameters<ReflectionRepository["promoteReflection"]>
  ) {
    return this.reflection.promoteReflection(...args)
  }
  recentCompactionSummaries(
    ...args: Parameters<ReflectionRepository["recentCompactionSummaries"]>
  ) {
    return this.reflection.recentCompactionSummaries(...args)
  }
  compactionDetail(
    ...args: Parameters<ReflectionRepository["compactionDetail"]>
  ) {
    return this.reflection.compactionDetail(...args)
  }
  recentCompactions(
    ...args: Parameters<ReflectionRepository["recentCompactions"]>
  ) {
    return this.reflection.recentCompactions(...args)
  }
  replaceReflectionEntries(
    ...args: Parameters<ReflectionRepository["replaceReflectionEntries"]>
  ) {
    return this.reflection.replaceReflectionEntries(...args)
  }

  // 主动回复留痕、质量标记与扫描进度。
  pruneProactiveReplies(
    ...args: Parameters<ProactiveRepository["pruneProactiveReplies"]>
  ) {
    return this.proactive.pruneProactiveReplies(...args)
  }
  groupProactiveCursor(
    ...args: Parameters<ProactiveRepository["groupProactiveCursor"]>
  ) {
    return this.proactive.groupProactiveCursor(...args)
  }
  setGroupProactiveCursor(
    ...args: Parameters<ProactiveRepository["setGroupProactiveCursor"]>
  ) {
    return this.proactive.setGroupProactiveCursor(...args)
  }
  insertProactiveReply(
    ...args: Parameters<ProactiveRepository["insertProactiveReply"]>
  ) {
    return this.proactive.insertProactiveReply(...args)
  }
  setProactiveQuality(
    ...args: Parameters<ProactiveRepository["setProactiveQuality"]>
  ) {
    return this.proactive.setProactiveQuality(...args)
  }
  proactiveReplies(
    ...args: Parameters<ProactiveRepository["proactiveReplies"]>
  ) {
    return this.proactive.proactiveReplies(...args)
  }
  proactiveGroupCounts(
    ...args: Parameters<ProactiveRepository["proactiveGroupCounts"]>
  ) {
    return this.proactive.proactiveGroupCounts(...args)
  }
  proactiveTotalCount(
    ...args: Parameters<ProactiveRepository["proactiveTotalCount"]>
  ) {
    return this.proactive.proactiveTotalCount(...args)
  }
  proactiveBadCount(
    ...args: Parameters<ProactiveRepository["proactiveBadCount"]>
  ) {
    return this.proactive.proactiveBadCount(...args)
  }

  // 问题主题、出现记录与排行游标；批量归类由调用方包在事务中。
  insertQuestionTopic(
    ...args: Parameters<TopicsRepository["insertQuestionTopic"]>
  ) {
    return this.topics.insertQuestionTopic(...args)
  }
  insertQuestionOccurrence(
    ...args: Parameters<TopicsRepository["insertQuestionOccurrence"]>
  ) {
    return this.topics.insertQuestionOccurrence(...args)
  }
  touchQuestionTopic(
    ...args: Parameters<TopicsRepository["touchQuestionTopic"]>
  ) {
    return this.topics.touchQuestionTopic(...args)
  }
  questionTopics(...args: Parameters<TopicsRepository["questionTopics"]>) {
    return this.topics.questionTopics(...args)
  }
  topicCursor(...args: Parameters<TopicsRepository["topicCursor"]>) {
    return this.topics.topicCursor(...args)
  }
  setTopicCursor(...args: Parameters<TopicsRepository["setTopicCursor"]>) {
    return this.topics.setTopicCursor(...args)
  }
  rankingByWindow(...args: Parameters<TopicsRepository["rankingByWindow"]>) {
    return this.topics.rankingByWindow(...args)
  }
  topicSamples(...args: Parameters<TopicsRepository["topicSamples"]>) {
    return this.topics.topicSamples(...args)
  }
  topicCursors(...args: Parameters<TopicsRepository["topicCursors"]>) {
    return this.topics.topicCursors(...args)
  }
  minTopicCursor(...args: Parameters<TopicsRepository["minTopicCursor"]>) {
    return this.topics.minTopicCursor(...args)
  }

  // 处理结果、模型用量与工具调用的增量统计。
  pruneResolutionEvents(
    ...args: Parameters<StatisticsRepository["pruneResolutionEvents"]>
  ) {
    return this.statistics.pruneResolutionEvents(...args)
  }
  insertResolution(
    ...args: Parameters<StatisticsRepository["insertResolution"]>
  ) {
    return this.statistics.insertResolution(...args)
  }
  resolutionCounts(
    ...args: Parameters<StatisticsRepository["resolutionCounts"]>
  ) {
    return this.statistics.resolutionCounts(...args)
  }
  addUsageDaily(...args: Parameters<StatisticsRepository["addUsageDaily"]>) {
    return this.statistics.addUsageDaily(...args)
  }
  usageDaily(...args: Parameters<StatisticsRepository["usageDaily"]>) {
    return this.statistics.usageDaily(...args)
  }
  addToolStatsDaily(
    ...args: Parameters<StatisticsRepository["addToolStatsDaily"]>
  ) {
    return this.statistics.addToolStatsDaily(...args)
  }
  toolStatsDaily(...args: Parameters<StatisticsRepository["toolStatsDaily"]>) {
    return this.statistics.toolStatsDaily(...args)
  }
  usageDailyTotalCost(
    ...args: Parameters<StatisticsRepository["usageDailyTotalCost"]>
  ) {
    return this.statistics.usageDailyTotalCost(...args)
  }

  // 人工工单的创建、关闭与查询；会话状态由会话模块管理。
  createTicket(...args: Parameters<TicketsRepository["createTicket"]>) {
    return this.tickets.createTicket(...args)
  }
  closeTicket(...args: Parameters<TicketsRepository["closeTicket"]>) {
    return this.tickets.closeTicket(...args)
  }
  closeOpenTicketsForSession(
    ...args: Parameters<TicketsRepository["closeOpenTicketsForSession"]>
  ) {
    return this.tickets.closeOpenTicketsForSession(...args)
  }
  getTicket(...args: Parameters<TicketsRepository["getTicket"]>) {
    return this.tickets.getTicket(...args)
  }
  openTickets(...args: Parameters<TicketsRepository["openTickets"]>) {
    return this.tickets.openTickets(...args)
  }
  listTickets(...args: Parameters<TicketsRepository["listTickets"]>) {
    return this.tickets.listTickets(...args)
  }

  // 配置键值存储；游标沿用原有键名，保持旧库兼容。
  getConfigRow(...args: Parameters<ConfigRepository["getConfigRow"]>) {
    return this.config.getConfigRow(...args)
  }
  setConfigRow(...args: Parameters<ConfigRepository["setConfigRow"]>) {
    return this.config.setConfigRow(...args)
  }
}
