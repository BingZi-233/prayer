import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { embedMock, batchMock, searchMock } = vi.hoisted(() => ({
  embedMock: vi.fn(async () => [0.1]), batchMock: vi.fn(), searchMock: vi.fn(async () => []),
}))
vi.mock("@/lib/tools/embed", () => ({ embed: embedMock }))
vi.mock("@/lib/agent/reflection-poller", () => ({
  isDuplicateOfHits: () => ({ duplicate: false, hit: null }),
  DEFAULT_DUP_TOP_K: 5,
  DEFAULT_DUP_MAX_DISTANCE: 0.45,
}))
vi.mock("@/lib/app-context", () => ({
  getAppContext: () => ({ repo: { rankingByWindow: () => [{ id: 1, title: "A", count: 1, lastTs: 2 }, { id: 2, title: "B", count: 1, lastTs: 1 }], topicSamplesBatch: batchMock, searchKb: searchMock } }),
}))
import { GET } from "@/app/api/ranking/route"

beforeEach(() => { embedMock.mockClear(); batchMock.mockReset(); searchMock.mockClear(); batchMock.mockReturnValue(new Map([[1, ["样例"]], [2, []]])) })

describe("ranking route", () => {
  it("uses one batch sample query and title fallback for empty samples", async () => {
    const res = await GET(new NextRequest("http://x/api/ranking"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(batchMock).toHaveBeenCalledTimes(1)
    expect(embedMock).toHaveBeenCalledTimes(2)
    expect(body.data.topics[1].samples).toEqual([])
  })
})
