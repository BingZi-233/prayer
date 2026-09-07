import { describe, expect, it } from "vitest"
import { groupPolicySchema } from "@/lib/config/schema"

describe("config group policy schema", () => {
  it("rejects negative proactive silence durations", () => {
    expect(
      groupPolicySchema.safeParse({ proactiveSilenceMs: -1 }).success
    ).toBe(false)
  })
})
