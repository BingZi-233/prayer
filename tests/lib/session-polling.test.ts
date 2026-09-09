import { describe, expect, it, vi } from "vitest"
import {
  commitIfMounted,
  createInFlightLoader,
  createSessionPoller,
} from "@/components/admin/session-polling"

describe("session poller", () => {
  it("does not commit a completed load after unmount", () => {
    let mounted = false
    const commit = vi.fn()

    expect(commitIfMounted("sessions", () => mounted, commit)).toBe(false)
    expect(commit).not.toHaveBeenCalled()

    mounted = true
    expect(commitIfMounted("sessions", () => mounted, commit)).toBe(true)
    expect(commit).toHaveBeenCalledWith("sessions")
  })

  it("reuses the same promise for concurrent external loads", async () => {
    let resolve!: (value: string) => void
    const load = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r
        })
    )
    const shared = createInFlightLoader(load)

    const first = shared()
    const second = shared()

    expect(first).toBe(second)
    expect(load).toHaveBeenCalledTimes(1)
    resolve("sessions")
    await expect(first).resolves.toBe("sessions")
  })

  it("reuses in-flight poll and schedules only after completion", async () => {
    let resolve!: () => void
    const load = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r
        })
    )
    const timers: (() => void)[] = []
    const p = createSessionPoller(load, {
      isHidden: () => false,
      setTimer: (fn) => {
        timers.push(fn)
        return 1 as never
      },
      clearTimer: vi.fn(),
    })
    const first = p.poll()
    const second = p.poll()
    expect(first).toBe(second)
    expect(load).toHaveBeenCalledTimes(1)
    resolve()
    await first
    expect(timers).toHaveLength(1)
  })
  it("stop prevents future scheduling and hidden polls", async () => {
    const load = vi.fn(async () => {})
    const setTimer = vi.fn(() => 1 as never)
    const clearTimer = vi.fn()
    const p = createSessionPoller(load, {
      isHidden: () => true,
      setTimer,
      clearTimer,
    })
    await p.poll()
    expect(load).not.toHaveBeenCalled()
    p.stop()
    expect(clearTimer).toHaveBeenCalledTimes(1)
    p.stop()
    expect(clearTimer).toHaveBeenCalledTimes(1)
  })

  it("keeps checking while hidden so the next visible tick can poll", async () => {
    const load = vi.fn(async () => {})
    const timers: (() => void)[] = []
    const p = createSessionPoller(load, {
      isHidden: () => true,
      setTimer: vi.fn((fn) => {
        timers.push(fn)
        return 1 as never
      }),
    })

    p.start()

    expect(load).not.toHaveBeenCalled()
    expect(timers).toHaveLength(1)
  })

  it("does not schedule after stop while a request is still in flight", async () => {
    let resolve!: () => void
    const load = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r
        })
    )
    const setTimer = vi.fn(() => 1 as never)
    const p = createSessionPoller(load, { isHidden: () => false, setTimer })

    const request = p.poll()
    p.stop()
    resolve()
    await request

    expect(setTimer).not.toHaveBeenCalled()
  })
})
