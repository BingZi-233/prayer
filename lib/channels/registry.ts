import { bus } from "../core/bus"
import type { ActionSend } from "../core/chat/events"
import { logger } from "../core/logger"
import type { Channel, ChannelId, ChannelStatus } from "../core/chat/types"
import type { OutboundStore } from "../core/chat/outbox"
import type { OutboxRecord } from "../core/chat/outbox"

/**
 * 多通道生命周期注册表 + 唯一 action.send 分发器。
 * - startAll 用 allSettled：单通道失败不回滚其它通道
 * - 出站：registry 独占 bus.on("action.send")，按 a.channel 调 channel.send
 * - 未注册 channel → error.occurred(scope=channel.unregistered)，禁止静默丢弃
 */
export class ChannelRegistry {
  private map = new Map<ChannelId, Channel>()
  private listening = false
  private retryTimer?: ReturnType<typeof setInterval>
  constructor(private readonly opts: { outbox?: OutboundStore; retryMs?: number; now?: () => number } = {}) {}

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
      if (this.opts.outbox) {
        const action = a.deliveryKey ? a : { ...a, deliveryKey: `legacy:${this.now()}:${Math.random()}` }
        const claimed = this.opts.outbox.enqueueAndClaim(action, this.now())
        if (claimed) {
          const marked = this.opts.outbox.markFailed(
            claimed.id,
            err.message,
            this.now() + 1000,
            claimed.claimToken
          )
          if (marked) {
            bus.emit("delivery.recorded", {
              deliveryKey: action.deliveryKey!,
              resolutionKey: action.resolutionKey,
              status: "failed",
              error: err.message,
              at: this.now(),
            })
          }
        }
      }
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
    let claimed: OutboxRecord | null = null
    let action = a
    try {
      const key = a.deliveryKey ?? (this.opts.outbox ? `legacy:${this.now()}:${Math.random()}` : undefined)
      action = key && !a.deliveryKey ? { ...a, deliveryKey: key } : a
      claimed = this.opts.outbox ? this.opts.outbox.enqueueAndClaim(action, this.now()) : null
      if (this.opts.outbox && !claimed) return
      await ch.send(action)
      if (claimed) {
        const marked = this.opts.outbox!.markSent(
          claimed.id,
          this.now(),
          claimed.claimToken
        )
        if (marked) {
          bus.emit("delivery.recorded", {
            deliveryKey: action.deliveryKey!,
            resolutionKey: action.resolutionKey,
            status: "sent",
            at: this.now(),
          })
        }
      }
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
      if (claimed) {
        const marked = this.opts.outbox?.markFailed(
          claimed.id,
          msg,
          this.now() + 1000,
          claimed.claimToken
        )
        if (marked) {
          bus.emit("delivery.recorded", {
            deliveryKey: action.deliveryKey!,
            resolutionKey: action.resolutionKey,
            status: "failed",
            error: msg,
            at: this.now(),
          })
        }
      }
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
    if (this.opts.outbox && !this.retryTimer) this.retryTimer = setInterval(() => this.retryDue(), this.opts.retryMs ?? 1000)
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
    if (this.retryTimer) { clearInterval(this.retryTimer); this.retryTimer = undefined }
  }
  private now(): number { return this.opts.now?.() ?? Date.now() }
  private async retryDue(): Promise<void> {
    if (!this.opts.outbox) return
    for (const r of this.opts.outbox.claimDue(20, this.now())) {
      const ch = this.map.get(r.action.channel)
      if (!ch) {
        const msg = `channel not registered: ${r.action.channel}`
        const marked = this.opts.outbox.markFailed(
          r.id,
          msg,
          this.now() + 1000,
          r.claimToken
        )
        if (marked) {
          bus.emit("delivery.recorded", {
            deliveryKey: r.action.deliveryKey!,
            resolutionKey: r.action.resolutionKey,
            status: "failed",
            error: msg,
            at: this.now(),
          })
        }
        continue
      }
      try {
        await ch.send(r.action)
        const marked = this.opts.outbox.markSent(r.id, this.now(), r.claimToken)
        if (marked) {
          bus.emit("delivery.recorded", {
            deliveryKey: r.action.deliveryKey!,
            resolutionKey: r.action.resolutionKey,
            status: "sent",
            at: this.now(),
          })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const marked = this.opts.outbox.markFailed(
          r.id,
          msg,
          this.now() + Math.min(
            60000,
            1000 * Math.pow(2, Math.max(0, r.attempts - 1))
          ),
          r.claimToken
        )
        if (marked) {
          bus.emit("delivery.recorded", {
            deliveryKey: r.action.deliveryKey!,
            resolutionKey: r.action.resolutionKey,
            status: "failed",
            error: msg,
            at: this.now(),
          })
        }
      }
    }
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
