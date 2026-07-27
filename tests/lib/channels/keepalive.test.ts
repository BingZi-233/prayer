import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  StaleWatchdog,
  withDeadline,
  DeadlineExceededError,
} from "@/lib/channels/keepalive"

describe("StaleWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("start 后到点触发 onStale", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(100)
    vi.advanceTimersByTime(99)
    expect(onStale).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("touch 重置倒计时", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(100)
    vi.advanceTimersByTime(80)
    w.touch()
    vi.advanceTimersByTime(80)
    expect(onStale).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("触发后自动停止,不重复触发", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(50)
    vi.advanceTimersByTime(200)
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(w.isRunning()).toBe(false)
  })

  it("触发后 touch 不复活(需重新 start)", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(50)
    vi.advanceTimersByTime(50)
    w.touch()
    vi.advanceTimersByTime(200)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("retune 改 deadline 并立即重置", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(1000)
    vi.advanceTimersByTime(500)
    w.retune(100)
    vi.advanceTimersByTime(99)
    expect(onStale).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("未 start 时 retune 只记录,不启动倒计时", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.retune(50)
    vi.advanceTimersByTime(500)
    expect(onStale).not.toHaveBeenCalled()
    w.start(50)
    vi.advanceTimersByTime(50)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("stop 后不触发,且 stop 幂等", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(50)
    w.stop()
    w.stop()
    vi.advanceTimersByTime(500)
    expect(onStale).not.toHaveBeenCalled()
    expect(w.isRunning()).toBe(false)
  })

  it("stop 后 touch 不重新武装", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(50)
    w.stop()
    w.touch()
    vi.advanceTimersByTime(500)
    expect(onStale).not.toHaveBeenCalled()
  })
})

describe("withDeadline", () => {
  it("按时返回则原样透传结果", async () => {
    const r = await withDeadline(async () => 42, 1000)
    expect(r).toBe(42)
  })

  it("超时抛 DeadlineExceededError 并 abort 传入的 signal", async () => {
    let aborted = false
    const p = withDeadline(
      (signal) =>
        new Promise<never>(() => {
          signal.addEventListener("abort", () => {
            aborted = true
          })
        }),
      20
    )
    await expect(p).rejects.toBeInstanceOf(DeadlineExceededError)
    expect(aborted).toBe(true)
  })

  it("fn 自身先失败则透传原错误,不包成 DeadlineExceededError", async () => {
    const boom = new Error("boom")
    await expect(
      withDeadline(async () => Promise.reject(boom), 1000)
    ).rejects.toBe(boom)
  })

  it("外部 signal abort 时,内部 signal 同步 abort", async () => {
    const outer = new AbortController()
    let innerAborted = false
    const p = withDeadline(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            innerAborted = true
            const e = new Error("aborted")
            e.name = "AbortError"
            reject(e)
          })
        }),
      5000,
      { signal: outer.signal }
    )
    outer.abort()
    await expect(p).rejects.toThrow("aborted")
    expect(innerAborted).toBe(true)
  })

  it("外部 signal 已 abort 时立即 abort 内部", async () => {
    const outer = new AbortController()
    outer.abort()
    const p = withDeadline((signal) => Promise.resolve(signal.aborted), 5000, {
      signal: outer.signal,
    })
    await expect(p).resolves.toBe(true)
  })

  it("正常返回后不再触发超时定时器", async () => {
    vi.useFakeTimers()
    try {
      const r = await withDeadline(async () => "ok", 10)
      expect(r).toBe("ok")
      // 若定时器未清理,推进时间会产生未处理拒绝
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()
    } finally {
      vi.useRealTimers()
    }
  })
})
