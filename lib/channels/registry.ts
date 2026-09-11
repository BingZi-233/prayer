import { bus } from "../core/bus"
import type { ActionSend } from "../core/chat/events"
import { logger } from "../core/logger"
import type { Channel, ChannelId, ChannelStatus } from "../core/chat/types"

/**
 * 多通道生命周期注册表 + 唯一 action.send 分发器。
 * - startAll 用 allSettled：单通道失败不回滚其它通道
 * - 出站：registry 独占 bus.on("action.send")，按 a.channel 调 channel.send
 * - 未注册 channel → error.occurred(scope=channel.unregistered)，禁止静默丢弃
 */
export class ChannelRegistry {
  private map = new Map<ChannelId, Channel>()
  private listening = false

  private readonly onAction = (a: ActionSend) => {
    void this.dispatch(a)
  }

  register(ch: Channel): void {
    this.map.set(ch.id, ch)
  }

  get(id: ChannelId): Channel | undefined {
    return this.map.get(id)
  }

  /**
   * 出站分发（单测可直接调；生产由 bus 触发）。
   * 未注册 → 受控 error；send 抛错 → channel.*.send error。
   */
  async dispatch(a: ActionSend): Promise<void> {
    const ch = this.map.get(a.channel)
    if (!ch) {
      const err = new Error(`channel not registered: ${a.channel}`)
      logger.log("warn", `[registry] ${err.message}`)
      bus.emit("error.occurred", {
        scope: "channel.unregistered",
        err,
        channel: a.channel,
        chatId: a.chatId,
        userVisible: false,
      })
      return
    }
    try {
      await ch.send(a)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.log("error", `[registry] channel ${a.channel} send failed: ${msg}`)
      bus.emit("error.occurred", {
        scope: `channel.${a.channel}.send`,
        err,
        channel: a.channel,
        chatId: a.chatId,
        userVisible: a.userVisibleOnFailure ?? false,
      })
    }
  }

  /**
   * 查询 per-chat 旁路是否可用。
   * 未注册通道 / 未实现 isBypassEnabled → true（不额外封锁）。
   */
  isBypassEnabled(channel: ChannelId, chatId: string): boolean {
    const ch = this.map.get(channel)
    if (!ch) return true
    if (typeof ch.isBypassEnabled === "function") {
      return ch.isBypassEnabled(chatId)
    }
    return true
  }

  async startAll(): Promise<PromiseSettledResult<void>[]> {
    this.ensureListening()
    const entries = [...this.map.values()]
    const results = await Promise.allSettled(entries.map((c) => c.start()))
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === "rejected") {
        const ch = entries[i]!
        const msg =
          r.reason instanceof Error ? r.reason.message : String(r.reason)
        logger.log("error", `[registry] channel ${ch.id} start failed: ${msg}`)
        ch.setLastError?.(msg)
      }
    }
    return results
  }

  async stopAll(): Promise<void> {
    this.stopListening()
    await Promise.allSettled([...this.map.values()].map((c) => c.stop()))
    this.map.clear()
  }

  status(): ChannelStatus[] {
    return [...this.map.values()].map((c) => c.status())
  }

  private ensureListening(): void {
    if (this.listening) return
    bus.on("action.send", this.onAction)
    this.listening = true
  }

  private stopListening(): void {
    if (!this.listening) return
    bus.off("action.send", this.onAction)
    this.listening = false
  }
}
