import { describe, expect, it } from "vitest"
import { withKbMutationLock } from "@/lib/knowledge/mutation-lock"

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("KB mutation lock", () => {
  it("serializes queued writers and releases after completion", async () => {
    const events: string[] = []
    let release!: () => void
    let started!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = withKbMutationLock(async () => {
      events.push("first:start")
      started()
      await gate
      events.push("first:end")
      return 1
    })
    await firstStarted

    const second = withKbMutationLock(async () => {
      events.push("second")
      return 2
    })
    await tick()
    expect(events).toEqual(["first:start"])

    release()
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
    expect(events).toEqual(["first:start", "first:end", "second"])
  })

  it("前一个 writer 失败后仍能继续执行后续 writer", async () => {
    await expect(
      withKbMutationLock(async () => {
        throw new Error("first failed")
      })
    ).rejects.toThrow("first failed")

    await expect(
      withKbMutationLock(async () => "second ok")
    ).resolves.toBe("second ok")
  })
})
