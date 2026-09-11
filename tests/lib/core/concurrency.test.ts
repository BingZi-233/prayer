import { describe, expect, it } from "vitest"
import { mapWithConcurrency } from "@/lib/core/concurrency"

describe("mapWithConcurrency", () => {
  it("keeps order and bounds active workers", async () => {
    let active = 0
    let maxActive = 0
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 4, async (n, i) => {
      active++; maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 2 + (5 - i)))
      active--; return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12])
    expect(maxActive).toBeLessThanOrEqual(4)
  })
  it("propagates worker errors and rejects non-positive limits", async () => {
    await expect(mapWithConcurrency([1], 4, async () => { throw new Error("boom") })).rejects.toThrow("boom")
    await expect(mapWithConcurrency([], 0, async (x) => x)).rejects.toThrow(RangeError)
  })
})
