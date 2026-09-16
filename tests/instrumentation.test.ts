import { describe, expect, it } from "vitest"
import { shouldBootRuntime } from "@/instrumentation"

describe("shouldBootRuntime", () => {
  it("starts automatically in Node by default", () => {
    expect(shouldBootRuntime({ NEXT_RUNTIME: "nodejs" })).toBe(true)
  })

  it("skips automatic startup when explicitly requested", () => {
    expect(
      shouldBootRuntime({
        NEXT_RUNTIME: "nodejs",
        NODE_ENV: "development",
        PRAYER_SKIP_RUNTIME_BOOT: "1",
      })
    ).toBe(false)
  })

  it("keeps automatic startup enabled in production", () => {
    expect(
      shouldBootRuntime({
        NEXT_RUNTIME: "nodejs",
        NODE_ENV: "production",
        PRAYER_SKIP_RUNTIME_BOOT: "1",
      })
    ).toBe(true)
  })

  it("does not start outside the Node runtime", () => {
    expect(shouldBootRuntime({ NEXT_RUNTIME: "edge" })).toBe(false)
  })
})
