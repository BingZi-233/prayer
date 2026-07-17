import { OneBotClient } from "../../onebot/client"
import type {
  Channel,
  ChannelCapabilities,
  ChannelStatus,
} from "../types"

const QQ_CAPABILITIES: ChannelCapabilities = {
  canNotifyOwnAdminSurface: true,
  supportsAdminCommands: true,
  supportsMemberList: true,
  supportsGroupList: true,
  supportsMediaDownload: true,
  supportsBypassPipeline: true,
}

/**
 * QQ / OneBot 通道适配器。
 * 内部仍用 OneBotClient；对外满足 Channel 接口。
 */
export class QqChannel implements Channel {
  readonly id = "qq" as const
  readonly capabilities = QQ_CAPABILITIES

  private client: OneBotClient
  private lastError?: string
  private detail?: string

  constructor(
    url: string,
    accessToken?: string,
    onStatus?: (connected: boolean) => void
  ) {
    this.client = new OneBotClient(url, accessToken, onStatus)
  }

  async start(): Promise<void> {
    this.lastError = undefined
    this.client.start()
  }

  async stop(): Promise<void> {
    this.client.stop()
  }

  isConnected(): boolean {
    return this.client.isConnected()
  }

  status(): ChannelStatus {
    return {
      id: this.id,
      connected: this.isConnected(),
      lastError: this.lastError,
      detail: this.detail,
    }
  }

  /** registry startAll 失败时写入 */
  setLastError(err: string): void {
    this.lastError = err
  }

  async listChats(): Promise<{ id: string; name: string }[] | undefined> {
    const raw = await this.client.getGroupList()
    if (!Array.isArray(raw)) return undefined
    return raw.map((g) => {
      const o = g as { group_id?: unknown; group_name?: unknown }
      const id = String(o.group_id ?? "")
      return { id, name: String(o.group_name ?? id) }
    })
  }

  async listMembers(chatId: string): Promise<unknown[] | undefined> {
    return this.client.getGroupMemberList(Number(chatId))
  }
}
