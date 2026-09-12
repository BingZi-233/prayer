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
})
