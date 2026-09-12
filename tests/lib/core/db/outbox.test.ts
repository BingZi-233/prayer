import { describe, expect, it } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"

describe("durable outbox", () => {
  it("deduplicates and reclaims leases", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const action = { channel: "qq" as const, chatId: "1", text: "x", deliveryKey: "k" }
    const a = repo.outbox.enqueueAndClaim(action, 100)
    expect(a).not.toBeNull()
    expect(repo.outbox.enqueueAndClaim(action, 101)).toBeNull()
    expect(repo.outbox.claimDue(5, 101)).toHaveLength(0)
    expect(repo.outbox.claimDue(5, 31_000)).toHaveLength(1)
  })
  it("fences stale workers and preserves one row", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const action = { channel: "qq" as const, chatId: "1", text: "x", deliveryKey: "fence" }
    const first = repo.outbox.enqueueAndClaim(action, 0)!
    const second = repo.outbox.claimDue(1, 31_000)[0]!
    expect(repo.outbox.markSent(first.id, 31_001, first.claimToken)).toBe(false)
    expect(repo.outbox.markSent(second.id, 31_002, second.claimToken)).toBe(true)
  })
  it("retries a failed row after its backoff with a fresh claim", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const action = { channel: "qq" as const, chatId: "1", text: "x", deliveryKey: "retry" }
    const first = repo.outbox.enqueueAndClaim(action, 0)!

    expect(repo.outbox.markFailed(first.id, "offline", 1_000, first.claimToken)).toBe(true)
    expect(repo.outbox.claimDue(1, 999)).toHaveLength(0)

    const retry = repo.outbox.claimDue(1, 1_000)[0]!
    expect(retry.id).toBe(first.id)
    expect(retry.attempts).toBe(2)
    expect(retry.claimToken).not.toBe(first.claimToken)
    expect(repo.outbox.markSent(retry.id, 1_001, retry.claimToken)).toBe(true)

    // The old worker cannot overwrite the newer attempt after reclaim.
    expect(repo.outbox.markFailed(retry.id, "late failure", 2_000, first.claimToken)).toBe(false)
  })
  it("resolution delivery keys are idempotent", () => {
    const repo = new Repo(openDb(":memory:", 3))
    repo.insertResolution("auto", { deliveryKey: "same" })
    repo.insertResolution("auto", { deliveryKey: "same" })
    expect(repo.resolutionCounts(0).auto).toBe(1)
  })
})
