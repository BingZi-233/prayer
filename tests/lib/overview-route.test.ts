import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  resolutionCounts,
  usageDailyTotalCost,
  proactiveBadCount,
  countReflectionEntries,
  countHumanSessions,
  statusCounts,
} = vi.hoisted(() => ({
  resolutionCounts: vi.fn(),
  usageDailyTotalCost: vi.fn(),
  proactiveBadCount: vi.fn(),
  countReflectionEntries: vi.fn(),
  countHumanSessions: vi.fn(),
  statusCounts: vi.fn(),
}))

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: () => ({
    cfg: {
      dbPath: ":memory:",
      brandName: "Prayer",
      brandDescription: "",
      enabledChats: [],
      usageBudgetUsd: 0,
    },
    repo: {
      resolutionCounts,
      usageDailyTotalCost,
      proactiveBadCount,
      countReflectionEntries,
      countHumanSessions,
      outbox: { statusCounts },
    },
  }),
}))

import { GET } from "@/app/api/overview/route"

beforeEach(() => {
  resolutionCounts.mockReset().mockReturnValue({
    auto: 8,
    proactive: 1,
    handoff: 1,
    error: 2,
    operational_error: 50,
  })
  usageDailyTotalCost.mockReset().mockReturnValue(0)
  proactiveBadCount.mockReset().mockReturnValue(0)
  countReflectionEntries.mockReset().mockReturnValue(0)
  countHumanSessions.mockReset().mockReturnValue(0)
  statusCounts.mockReset().mockReturnValue({
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
  })
})

describe("GET /api/overview resolution metrics", () => {
  it("keeps backend operational errors visible but out of auto resolution rate", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.metrics).toMatchObject({
      error: 2,
      operationalErrors: 50,
      autoResolutionRate: 8 / 12,
    })
  })
})
