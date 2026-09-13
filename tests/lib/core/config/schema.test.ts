import { describe, expect, it } from "vitest"
import { appConfigSchema } from "@/lib/core/config/schema"

describe("app config proactive candidate budget", () => {
  it("defaults proactiveCandidateBudget to 12", () => {
    expect(appConfigSchema.parse({}).proactiveCandidateBudget).toBe(12)
  })

  it("accepts a candidate budget independently from the answer cap", () => {
    const cfg = appConfigSchema.parse({
      proactiveMaxPerScan: 2,
      proactiveCandidateBudget: 7,
    })
    expect(cfg.proactiveCandidateBudget).toBe(7)
  })

  it("clamps a candidate budget below the answer cap to the answer cap", () => {
    const cfg = appConfigSchema.parse({
      proactiveMaxPerScan: 9,
      proactiveCandidateBudget: 2,
    })
    expect(cfg.proactiveCandidateBudget).toBe(9)
  })
})
