/** 通道标识；discord 一期仅预留类型，不实现 */
export type ChannelId = "qq" | "tg" | "discord"

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

export interface Channel {
  readonly id: ChannelId
  readonly capabilities: ChannelCapabilities
  start(): Promise<void>
  stop(): Promise<void>
  isConnected(): boolean
  status(): ChannelStatus
  listChats?(): Promise<{ id: string; name: string }[] | undefined>
  listMembers?(chatId: string): Promise<unknown[] | undefined>
}
