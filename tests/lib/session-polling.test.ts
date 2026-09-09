import { describe, expect, it, vi } from "vitest"
import {
  commitIfMounted,
  createInFlightLoader,
  createMountedInFlightLoader,
  createSessionListCoordinator,
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

  it("shares a mounted page loader and skips commit after cleanup", async () => {
    let resolve!: (value: string) => void
    let mounted = true
    const commit = vi.fn()
    const load = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((r) => {
            resolve = r
          })
      )
      .mockResolvedValue("sessions")
    const shared = createMountedInFlightLoader(load, () => mounted, commit)

    const first = shared()
    const second = shared()
    void second
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)

    mounted = false
    resolve("sessions")
    await expect(first).resolves.toBe("sessions")
    expect(commit).not.toHaveBeenCalled()

    mounted = true
    await expect(shared()).resolves.toBe("sessions")
    expect(commit).toHaveBeenCalledWith("sessions")
  })

  it("shares one list load between poll and manual paths", async () => {
    let resolve!: (value: string) => void
    let mounted = true
    const commit = vi.fn()
    const load = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((r) => {
            resolve = r
          })
      )
      .mockResolvedValue("sessions")
    const coordinator = createSessionListCoordinator(
      load,
      () => mounted,
      commit,
      { isHidden: () => false, setTimer: () => 1 as never }
    )

    const polled = coordinator.poller.poll()
    const manualActions = [
      coordinator.loadSessions(), // refresh
      coordinator.loadSessions(), // resetAll
      coordinator.loadSessions(), // resetOne
      coordinator.loadSessions(), // resumeHandoff
    ]
    await Promise.resolve()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    mounted = false
    resolve("sessions")
    await Promise.all([polled, ...manualActions])
    expect(commit).not.toHaveBeenCalled()

    mounted = true
    await coordinator.loadSessions()
    expect(commit).toHaveBeenCalledWith("sessions")
  })

  it("swallows coordinator afterPoll failures and schedules another tick", async () => {
    const timers: (() => void)[] = []
    const afterPoll = vi.fn().mockRejectedValue(new Error("transcript failure"))
    const coordinator = createSessionListCoordinator(
      vi.fn().mockResolvedValue("sessions"),
      () => true,
      vi.fn(),
      {
        isHidden: () => false,
        setTimer: vi.fn((fn) => {
          timers.push(fn)
          return 1 as never
        }),
      },
      afterPoll
    )

    coordinator.poller.start()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(afterPoll).toHaveBeenCalledTimes(1)
    expect(timers).toHaveLength(1)

    timers.shift()!()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(afterPoll).toHaveBeenCalledTimes(2)
    expect(timers).toHaveLength(1)
    coordinator.poller.stop()
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
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    resolve("sessions")
    await expect(first).resolves.toBe("sessions")
  })

  it("allows retry after a rejected load", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce("sessions")
    const shared = createInFlightLoader(load)

    await expect(shared()).rejects.toThrow("temporary")
    await expect(shared()).resolves.toBe("sessions")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("turns a synchronous loader throw into a rejected promise and allows retry", async () => {
    let attempts = 0
    const load = vi.fn(() => {
      attempts += 1
      if (attempts === 1) throw new Error("sync failure")
      return "sessions"
    })
    const shared = createInFlightLoader(load)

    await expect(shared()).rejects.toThrow("sync failure")
    await expect(shared()).resolves.toBe("sessions")
    expect(load).toHaveBeenCalledTimes(2)
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

  it("swallows scheduled poll failures and schedules the next tick", async () => {
    const load = vi.fn().mockRejectedValue(new Error("poll failure"))
    const timers: (() => void)[] = []
    const p = createSessionPoller(load, {
      isHidden: () => false,
      setTimer: vi.fn((fn) => {
        timers.push(fn)
        return 1 as never
      }),
    })

    p.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    expect(timers).toHaveLength(1)
    timers.shift()!()
    await Promise.resolve()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(2)
    p.stop()
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
    let hidden = true
    const p = createSessionPoller(load, {
      isHidden: () => hidden,
      setTimer: vi.fn((fn) => {
        timers.push(fn)
        return 1 as never
      }),
    })

    p.start()

    expect(load).not.toHaveBeenCalled()
    expect(timers).toHaveLength(1)
    hidden = false
    timers.shift()!()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
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
