import { describe, expect, it } from "vitest"
import { appConfigSchema, groupPolicySchema } from "@/lib/core/config/schema"

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

  it("bounds proactive cadence and per-scan volume", () => {
    const cfg = appConfigSchema.parse({
      proactiveScanMs: 1,
      proactiveSilenceMs: 1,
      proactiveMaxPerScan: 999,
      proactiveCandidateBudget: 999,
    })
    expect(cfg.proactiveScanMs).toBe(10_000)
    expect(cfg.proactiveSilenceMs).toBe(30_000)
    expect(cfg.proactiveMaxPerScan).toBe(10)
    expect(cfg.proactiveCandidateBudget).toBe(50)
  })

  it("拒绝群级静默窗口低于保守下限", () => {
    expect(() => groupPolicySchema.parse({ proactiveSilenceMs: 1 })).toThrow()
  })

  it("拒绝超过 Node 定时器上限的群级静默窗口", () => {
    expect(() =>
      groupPolicySchema.parse({ proactiveSilenceMs: 2 ** 31 })
    ).toThrow()
  })
})
