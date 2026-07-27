/**
 * 通道无关的保活原语。
 * 不 import 任何具体通道代码；定时器可注入，便于假定时器单测。
 */

type TimerHandle = ReturnType<typeof setTimeout>

export interface StaleWatchdogOpts {
  /** 到点未被 touch 时调用；触发后 watchdog 自动进入 stopped */
  onStale: () => void
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (t: TimerHandle) => void
}

/**
 * 单个可重置的 deadline（不是轮询 interval）。
 * 语义：start 武装 → touch 重置 → 到点触发一次 onStale 后自动停。
 */
export class StaleWatchdog {
  private timer?: TimerHandle
  private deadlineMs = 0
  private running = false
  private readonly onStale: () => void
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  private readonly clearTimer: (t: TimerHandle) => void

  constructor(opts: StaleWatchdogOpts) {
    this.onStale = opts.onStale
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t))
  }

  isRunning(): boolean {
    return this.running
  }

  start(ms: number): void {
    this.deadlineMs = ms
    this.running = true
    this.arm()
  }

  /** 有活动：按当前 deadline 重置。未运行时无副作用 */
  touch(): void {
    if (!this.running) return
    this.arm()
  }

  /** 改 deadline；运行中则立即重置 */
  retune(ms: number): void {
    this.deadlineMs = ms
    if (this.running) this.arm()
  }

  stop(): void {
    this.running = false
    this.disarm()
  }

  private arm(): void {
    this.disarm()
    this.timer = this.setTimer(() => {
      this.timer = undefined
      this.running = false
      this.onStale()
    }, this.deadlineMs)
  }

  private disarm(): void {
    if (this.timer === undefined) return
    this.clearTimer(this.timer)
    this.timer = undefined
  }
}

/** withDeadline 超时专用错误；调用方据此区分「超时」与「停机 abort」 */
export class DeadlineExceededError extends Error {
  constructor(public readonly ms: number) {
    super(`deadline exceeded after ${ms}ms`)
    this.name = "DeadlineExceededError"
  }
}

export interface WithDeadlineOpts {
  /** 外部停机信号；abort 时内部 signal 一并 abort（此时抛 fn 自己的错误，不是 DeadlineExceededError） */
  signal?: AbortSignal
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (t: TimerHandle) => void
}

/**
 * 给返回 Promise 的调用套硬超时。
 * 超时 → abort 传给 fn 的 signal 并抛 DeadlineExceededError（即便 fn 无视 abort 也会拒绝，靠 race 保证）。
 */
export function withDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  opts?: WithDeadlineOpts
): Promise<T> {
  const setTimer = opts?.setTimer ?? ((f, m) => setTimeout(f, m))
  const clearTimer = opts?.clearTimer ?? ((t) => clearTimeout(t))
  const ac = new AbortController()
  const outer = opts?.signal
  const onOuterAbort = () => ac.abort()
  if (outer) {
    if (outer.aborted) ac.abort()
    else outer.addEventListener("abort", onOuterAbort, { once: true })
  }

  let timer: TimerHandle | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimer(() => {
      ac.abort()
      reject(new DeadlineExceededError(ms))
    }, ms)
  })

  const work = fn(ac.signal)
  // race 结束后 fn 可能才拒绝，挂个空 catch 防未处理拒绝告警
  work.catch(() => {})

  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimer(timer)
    outer?.removeEventListener("abort", onOuterAbort)
  })
}
