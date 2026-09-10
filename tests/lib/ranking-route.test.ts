import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { embedMock, batchMock, searchMock, rankedMock } = vi.hoisted(() => ({
  embedMock: vi.fn(async (probe: string) => { await new Promise((r) => setTimeout(r, 1)); return [0.1] }),
  batchMock: vi.fn(), searchMock: vi.fn(async () => []),
  rankedMock: vi.fn(() => [{ id: 1, title: "A", count: 1, lastTs: 2 }, { id: 2, title: "B", count: 1, lastTs: 1 }]),
}))
vi.mock("@/lib/tools/embed", () => ({ embed: embedMock }))
vi.mock("@/lib/agent/reflection-poller", () => ({
  isDuplicateOfHits: () => ({ duplicate: false, hit: null }),
  DEFAULT_DUP_TOP_K: 5,
  DEFAULT_DUP_MAX_DISTANCE: 0.45,
}))
vi.mock("@/lib/core/app-context", () => ({
  getAppContext: () => ({ repo: { rankingByWindow: rankedMock, topicSamplesBatch: batchMock, searchKb: searchMock } }),
}))
import { GET } from "@/app/api/ranking/route"

beforeEach(() => { embedMock.mockClear().mockImplementation(async () => [0.1]); batchMock.mockReset(); searchMock.mockClear().mockImplementation(async () => []); rankedMock.mockClear().mockImplementation(() => [{ id: 1, title: "A", count: 1, lastTs: 2 }, { id: 2, title: "B", count: 1, lastTs: 1 }]); batchMock.mockReturnValue(new Map([[1, ["样例"]], [2, []]])) })

describe("ranking route", () => {
  it("uses one batch sample query and title fallback for empty samples", async () => {
    const res = await GET(new NextRequest("http://x/api/ranking"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(batchMock).toHaveBeenCalledTimes(1)
    expect(embedMock).toHaveBeenCalledTimes(2)
    expect(embedMock).toHaveBeenLastCalledWith("B")
    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(body.data.topics[1].samples).toEqual([])
  })

  it("embeds and searches exactly the first 30 topics, with bounded concurrency", async () => {
    rankedMock.mockReturnValue(Array.from({ length: 31 }, (_, id) => ({ id, title: `T${id}`, count: 1, lastTs: id })))
    batchMock.mockReturnValue(new Map(Array.from({ length: 31 }, (_, id) => [id, [`S${id}`]])))
    let active = 0, maxActive = 0
    embedMock.mockImplementation(async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 2)); active--; return [0.1] })
    const res = await GET(new NextRequest("http://x/api/ranking"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(embedMock).toHaveBeenCalledTimes(30)
    expect(searchMock).toHaveBeenCalledTimes(30)
    expect(maxActive).toBeLessThanOrEqual(4)
    expect(body.data.topics[30].kbCovered).toBeNull()
    expect(body.data.topics[30].kbDistance).toBeNull()
  })

  it("returns 500 when embedding fails and returns empty topics for no ranking", async () => {
    embedMock.mockRejectedValueOnce(new Error("embed failed"))
    expect((await GET(new NextRequest("http://x/api/ranking"))).status).toBe(500)
    rankedMock.mockReturnValue([])
    embedMock.mockClear(); batchMock.mockReturnValue(new Map())
    const res = await GET(new NextRequest("http://x/api/ranking"))
    expect(res.status).toBe(200)
    expect((await res.json()).data.topics).toEqual([])
  })

  it("returns 500 when KB search fails", async () => {
    rankedMock.mockReturnValue([{ id: 1, title: "A", count: 1, lastTs: 1 }])
    batchMock.mockReturnValue(new Map([[1, ["样例"]]]))
    searchMock.mockImplementationOnce(() => { throw new Error("search failed") })
    expect((await GET(new NextRequest("http://x/api/ranking"))).status).toBe(500)
  })
})
