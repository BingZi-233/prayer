import type { ActionSend } from "./events"

/** 通道标识；discord 一期仅预留类型，不实现 */
export const CHANNEL_IDS = ["qq", "tg", "discord"] as const
export type ChannelId = (typeof CHANNEL_IDS)[number]

/** 通道无关会话引用（白名单 / 游标 / policy / 管理面） */
export interface ChatRef {
  channel: ChannelId
  chatId: string
}

export interface ChannelCapabilities {
  /** 平台是否具备「本通道管理侧通知」能力（未来用）；一期不用于 handoff 路由 */
  canNotifyOwnAdminSurface: boolean
  supportsAdminCommands: boolean
  supportsMemberList: boolean
  supportsGroupList: boolean
  supportsMediaDownload: boolean
  /** 旁路（反思/补位）是否具备可靠 senderRole + 全量消息 */
  supportsBypassPipeline: boolean
}

export interface ChannelStatus {
  id: ChannelId
  connected: boolean
  lastError?: string
  detail?: string
}

/**
 * 通道适配器：平台 IO + 协议映射。
 * - 入站：内部 parse/enrich 后 bus.emit("message.received")
 * - 出站：由 ChannelRegistry 统一订 action.send 后调 send()
 * - 旁路：可选 isBypassEnabled(chatId)；agent 不得 import 平台旁路实现
 */
export interface Channel {
  readonly id: ChannelId
  readonly capabilities: ChannelCapabilities
  start(): Promise<void>
  stop(): Promise<void>
  isConnected(): boolean
  status(): ChannelStatus
  /** 出站发送；仅由 registry 在 channel 匹配时调用 */
  send(action: ActionSend): Promise<void>
  /**
   * 该 chat 旁路（反思/主动补位/主题）是否可用。
   * 缺省视为 true；TG 在 admins 失败 / Privacy 启发式时返回 false。
   */
  isBypassEnabled?(chatId: string): boolean
  listChats?(): Promise<{ id: string; name: string }[] | undefined>
  listMembers?(chatId: string): Promise<unknown[] | undefined>
  /** 按 chatId 解析显示名(TG getChat / 缓存);缺省则无 */
  resolveChatTitle?(chatId: string): Promise<string | undefined>
  /** registry startAll 失败时写入 lastError */
  setLastError?(err: string): void
}
