import { bus, emitErrorSafely } from "../core/bus"
import type { ActionSend, EventMap } from "../core/chat/events"
import { logger } from "../core/logger"
import { errorMessage, redactDiagnostic } from "../core/log-context"
import type { Channel, ChannelId, ChannelStatus } from "../core/chat/types"
import type { OutboundStore, OutboxRecord } from "../core/chat/outbox"

const DEFAULT_STOP_TIMEOUT_MS = 1000

/**
 * 多通道生命周期注册表 + 唯一 action.send 分发器。
 * - startAll 用 allSettled：单通道失败不回滚其它通道，由 Runtime 决定降级/就绪
 * - 出站：registry 独占 bus.on("action.send")，按 a.channel 调 channel.send
 * - 未注册 channel → error.occurred(scope=channel.unregistered)，禁止静默丢弃
 */
export class ChannelRegistry {
  private map = new Map<ChannelId, Channel>()
  private startErrors = new Map<ChannelId, string>()
  private listening = false
  private retryTimer?: ReturnType<typeof setInterval>
  private retryGeneration = 0
  private retryStopping = false
  private retryInFlight = new Set<Promise<void>>()
  constructor(
    private readonly opts: {
      outbox?: OutboundStore
      retryMs?: number
      now?: () => number
      stopTimeoutMs?: number
    } = {}
  ) {}

  private readonly onAction = (a: ActionSend) => {
    // EventEmitter does not await handlers. Keep an unexpected storage or
    // observer failure from becoming an unhandled rejection in the process.
    void this.dispatch(a).catch((err) => {
      this.logDispatchFailure(a, err, "channel.dispatch")
    })
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
      this.handleUnregistered(a)
      return
    }
    let claimed: OutboxRecord | null = null
    let action = a

    // Persistence failures before transport must never be mislabeled as a
    // channel failure (and must not send an unclaimed message).
    try {
      const key =
        a.deliveryKey ??
        (this.opts.outbox ? `legacy:${this.now()}:${Math.random()}` : undefined)
      action = key && !a.deliveryKey ? { ...a, deliveryKey: key } : a
      claimed = this.opts.outbox
        ? this.opts.outbox.enqueueAndClaim(action, this.now())
        : null
      if (this.opts.outbox && !claimed) return
    } catch (err) {
      this.logOutboxFailure(a, err, "outbox.persist")
      return
    }

    // Transport is authoritative. Once it resolves, never mark the row
    // failed: doing so would schedule a second platform send.
    try {
      await ch.send(action)
    } catch (err) {
      const msg = this.logDispatchFailure(a, err, `channel.${a.channel}.send`)
      if (claimed) this.persistFailedDelivery(claimed, action, msg)
      return
    }

    if (claimed) {
      try {
        const marked = this.opts.outbox!.markSent(
          claimed.id,
          this.now(),
          claimed.claimToken
        )
        if (marked) this.recordDelivery(action, "sent")
      } catch (err) {
        // Keep the sending lease for recovery; do not call markFailed after a
        // successful transport, otherwise the retry loop can duplicate it.
        this.logOutboxFailure(action, err, "outbox.persist")
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
    this.retryStopping = false
    this.startErrors.clear()
    this.ensureListening()
    if (this.opts.outbox && !this.retryTimer)
      this.retryTimer = setInterval(() => {
        // Timer callbacks do not observe returned promises. Keep storage or
        // adapter failures on the operational error bus instead of creating
        // an unhandled rejection that can destabilize the process.
        void this.retryDue().catch((err) => {
          const message = redactDiagnostic(errorMessage(err))
          logger.error(
            `[registry] outbox retry failed: ${message}`,
            {
              scope: "outbox.retry",
              raw: err instanceof Error ? err.stack : String(err),
            }
          )
          emitErrorSafely({
            scope: "outbox.retry",
            err,
            userVisible: false,
          })
        })
      }, this.opts.retryMs ?? 1000)
    const entries = [...this.map.values()]
    // Wrap invocation in a microtask so adapters that throw synchronously are
    // handled by allSettled just like ordinary rejected start promises.
    const results = await Promise.allSettled(
      entries.map((c) => Promise.resolve().then(() => c.start()))
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === "rejected") {
        const ch = entries[i]!
        const msg = redactDiagnostic(errorMessage(r.reason))
        this.startErrors.set(ch.id, msg)
        logger.log("error", `[registry] channel ${ch.id} start failed: ${msg}`)
        try {
          ch.setLastError?.(msg)
        } catch (error) {
          logger.error(
            `[registry] channel ${ch.id} failed to expose start error: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { scope: "channel.start-status" }
          )
        }
        this.emitError({
          scope: `channel.${ch.id}.start`,
          err: r.reason,
          channel: ch.id,
          userVisible: false,
        })
      }
    }
    return results
  }

  async stopAll(): Promise<void> {
    this.retryStopping = true
    this.retryGeneration++
    // Stop scheduling retries before awaiting adapters; otherwise a slow
    // channel.stop() can race an outbox send against the teardown path.
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = undefined
    }
    this.stopListening()
    // A retry may already be inside channel.send(). Drain it before stopping
    // adapters so an old registry cannot finish a send/write after reconfigure.
    const retries = [...this.retryInFlight]
    if (!(await this.waitForSettled(retries, this.stopTimeoutMs()))) {
      const err = new Error(
        `outbox retry drain timed out after ${this.stopTimeoutMs()}ms; sending leases retained`
      )
      logger.error(`[registry] ${err.message}`, {
        scope: "outbox.retry.stop-timeout",
      })
      this.emitError({
        scope: "outbox.retry.stop-timeout",
        err,
        userVisible: false,
      })
    }
    const entries = [...this.map.values()]
    const stops = entries.map((c) => Promise.resolve().then(() => c.stop()))
    for (let i = 0; i < stops.length; i++) {
      if (await this.waitForSettled([stops[i]!], this.stopTimeoutMs())) {
        try {
          await stops[i]!
        } catch (error) {
          const message = redactDiagnostic(errorMessage(error))
          logger.error(
            `[registry] channel ${entries[i]!.id} stop failed: ${message}`,
            {
              scope: `channel.${entries[i]!.id}.stop`,
              channel: entries[i]!.id,
              raw: error instanceof Error ? error.stack : String(error),
            }
          )
          this.emitError({
            scope: `channel.${entries[i]!.id}.stop`,
            err: error,
            channel: entries[i]!.id,
            userVisible: false,
          })
        }
        continue
      }
      const ch = entries[i]!
      const err = new Error(
        `channel ${ch.id} stop timed out after ${this.stopTimeoutMs()}ms`
      )
      logger.error(`[registry] ${err.message}`, {
        scope: `channel.${ch.id}.stop-timeout`,
        channel: ch.id,
      })
      this.emitError({
        scope: `channel.${ch.id}.stop-timeout`,
        err,
        channel: ch.id,
        userVisible: false,
      })
    }
    this.map.clear()
    this.startErrors.clear()
  }
  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }
  private retryDelayMs(attempts: number): number {
    return Math.min(60000, 1000 * Math.pow(2, Math.max(0, attempts - 1)))
  }
  private stopTimeoutMs(): number {
    const value = this.opts.stopTimeoutMs
    return Number.isFinite(value)
      ? Math.max(0, value as number)
      : DEFAULT_STOP_TIMEOUT_MS
  }
  private async waitForSettled(
    promises: readonly Promise<unknown>[],
    timeoutMs: number
  ): Promise<boolean> {
    if (promises.length === 0) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = Promise.allSettled(promises).then(() => true)
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    const result = await Promise.race([settled, timeout])
    if (timer) clearTimeout(timer)
    return result
  }
  private retryDue(): Promise<void> {
    const generation = this.retryGeneration
    const work = this.retryDueForGeneration(generation)
    this.retryInFlight.add(work)
    work.then(
      () => this.retryInFlight.delete(work),
      () => this.retryInFlight.delete(work)
    )
    return work
  }

  private async retryDueForGeneration(generation: number): Promise<void> {
    if (
      !this.opts.outbox ||
      this.retryStopping ||
      generation !== this.retryGeneration
    )
      return
    // Claim one row per tick: the lease starts when claimDue runs, so claiming
    // a batch and then sending sequentially can let later rows expire before
    // their turn (the channel deadline is already close to the 30s lease).
    for (const r of this.opts.outbox.claimDue(1, this.now())) {
      if (
        this.retryStopping ||
        generation !== this.retryGeneration
      )
        return
      const ch = this.map.get(r.action.channel)
      if (!ch) {
        const msg = `channel not registered: ${r.action.channel}`
        this.logOutboxFailure(r.action, new Error(msg), "channel.unregistered")
        try {
          this.failDelivery(r, r.action, msg)
        } catch (error) {
          this.logOutboxFailure(r.action, error, "outbox.persist")
        }
        continue
      }
      try {
        await ch.send(r.action)
      } catch (e) {
        if (
          this.retryStopping ||
          generation !== this.retryGeneration
        )
          return
        const msg = this.logDispatchFailure(
          r.action,
          e,
          `channel.${r.action.channel}.retry`,
          false
        )
        this.persistFailedDelivery(r, r.action, msg)
        continue
      }
      if (
        this.retryStopping ||
        generation !== this.retryGeneration
      )
        return
      try {
        const marked = this.opts.outbox.markSent(r.id, this.now(), r.claimToken)
        if (marked) this.recordDelivery(r.action, "sent")
      } catch (error) {
        // The transport already succeeded. Leave the lease for recovery rather
        // than converting this into a failed delivery and sending twice.
        this.logOutboxFailure(r.action, error, "outbox.persist")
      }
    }
  }

  status(): ChannelStatus[] {
    return [...this.map.values()].map((c) => {
      let status: ChannelStatus
      try {
        status = c.status()
      } catch (err) {
        const message = redactDiagnostic(errorMessage(err))
        const statusError = new Error(`channel ${c.id} status failed: ${message}`)
        logger.error(`[registry] ${statusError.message}`, {
          scope: `channel.${c.id}.status`,
          channel: c.id,
          raw: err instanceof Error ? err.stack : String(err),
        })
        this.emitError({
          scope: `channel.${c.id}.status`,
          err,
          channel: c.id,
          userVisible: false,
        })
        return { id: c.id, connected: false, lastError: message }
      }
      const startError = this.startErrors.get(c.id)
      return startError && !status.lastError
        ? { ...status, lastError: startError }
        : status
    })
  }

  private recordDelivery(
    action: Pick<
      ActionSend,
      "channel" | "chatId" | "deliveryKey" | "resolutionKey"
    >,
    status: EventMap["delivery.recorded"]["status"],
    error?: string
  ): void {
    const event: EventMap["delivery.recorded"] = {
      deliveryKey: action.deliveryKey!,
      resolutionKey: action.resolutionKey,
      status,
      at: this.now(),
    }
    if (error !== undefined) event.error = redactDiagnostic(error)
    try {
      bus.emit("delivery.recorded", event)
    } catch (observerError) {
      // A delivery observer is persistence/telemetry after transport. Keep
      // transport authoritative and classify observer failure accordingly.
      this.logOutboxFailure(action, observerError, "outbox.persist")
    }
  }

  private persistFailedDelivery(
    record: Pick<OutboxRecord, "id" | "attempts" | "claimToken">,
    action: ActionSend,
    error: string
  ): void {
    try {
      this.failDelivery(record, action, error)
    } catch (persistError) {
      this.logOutboxFailure(action, persistError, "outbox.persist")
    }
  }

  private failDelivery(
    record: Pick<OutboxRecord, "id" | "attempts" | "claimToken">,
    action: ActionSend,
    error: string
  ): void {
    const safeError = redactDiagnostic(error)
    const marked = this.opts.outbox?.markFailed(
      record.id,
      safeError,
      this.now() + this.retryDelayMs(record.attempts),
      record.claimToken
    )
    if (marked) this.recordDelivery(action, "failed", safeError)
  }

  private handleUnregistered(a: ActionSend): void {
    const err = new Error(`channel not registered: ${a.channel}`)
    if (this.opts.outbox) {
      const action = a.deliveryKey
        ? a
        : { ...a, deliveryKey: `legacy:${this.now()}:${Math.random()}` }
      try {
        const claimed = this.opts.outbox.enqueueAndClaim(action, this.now())
        if (claimed) this.failDelivery(claimed, action, err.message)
      } catch (persistError) {
        logger.error(
          `[registry] failed to persist orphan delivery: ${
            persistError instanceof Error
              ? persistError.message
              : String(persistError)
          }`,
          { scope: "outbox.persist" }
        )
      }
    }
    logger.log("warn", `[registry] ${err.message}`)
    this.emitError({
      scope: "channel.unregistered",
      err,
      channel: a.channel,
      chatId: a.chatId,
      userVisible: false,
    })
  }

  private logDispatchFailure(
    action: ActionSend,
    err: unknown,
    scope: string,
    userVisible = action.userVisibleOnFailure ?? false
  ): string {
    const msg = redactDiagnostic(errorMessage(err))
    logger.error(`[registry] channel ${action.channel} send failed: ${msg}`, {
      scope,
      channel: action.channel,
      chatId: action.chatId,
      raw: err instanceof Error ? err.stack : String(err),
    })
    this.emitError({
      scope,
      err,
      channel: action.channel,
      chatId: action.chatId,
      userVisible,
    })
    return msg
  }

  private logOutboxFailure(
    action: Pick<ActionSend, "channel" | "chatId">,
    err: unknown,
    scope: string
  ): void {
    const msg = redactDiagnostic(errorMessage(err))
    logger.error(`[registry] ${scope} failed: ${msg}`, {
      scope,
      channel: action.channel,
      chatId: action.chatId,
      raw: err instanceof Error ? err.stack : String(err),
    })
    this.emitError({
      scope,
      err,
      channel: action.channel,
      chatId: action.chatId,
      userVisible: false,
    })
  }

  private emitError(event: EventMap["error.occurred"]): void {
    emitErrorSafely(event)
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
