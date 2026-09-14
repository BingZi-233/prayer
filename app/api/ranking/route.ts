import { NextRequest, NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { embed } from "@/lib/model/embed"
import { mapWithConcurrency } from "@/lib/core/concurrency"
import {
  isDuplicateOfHits,
  DEFAULT_DUP_TOP_K,
  DEFAULT_DUP_MAX_DISTANCE,
} from "@/lib/knowledge/reflection/poller"

// 窗口 → 起始时间戳(ms)。all → 0。
function sinceTs(window: string, now: number): number {
  if (window === "30d") return now - 30 * 86_400_000
  if (window === "all") return 0
  return now - 7 * 86_400_000 // 默认 7d
}

const TOP_KB = 30 // 只对前 N 主题算 KB 命中,控制 embedding 次数
const MAX_TOPICS = 500 // 管理面响应硬上限;完整历史仍保留在数据库

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { repo } = getAppContext()
    const now = Date.now()
    const raw = req.nextUrl.searchParams.get("window") ?? "7d"
    const window = raw === "30d" || raw === "all" ? raw : "7d"
    const since = sinceTs(window, now)

    // Repository 已在 SQL 层限流;这里再切一刀可保护测试替身/旧实现,避免
    // topicSamplesBatch 和 JSON 响应随着历史数据无限膨胀。
    const ranked = repo.rankingByWindow(since).slice(0, MAX_TOPICS)
    // totals 走单行 COUNT,不因列表 cap 而低报;旧测试替身没有该方法时回退。
    const fullTotals =
      typeof repo.rankingTotalsByWindow === "function"
        ? repo.rankingTotalsByWindow(since)
        : null
    const topics = []
    let gaps = 0
    let questions = 0
    const samplesByTopic = repo.topicSamplesBatch(
      ranked.map((r) => r.id),
      5,
      since
    )
    const probes = await mapWithConcurrency(
      ranked.slice(0, TOP_KB),
      4,
      async (r) => {
        const samples = samplesByTopic.get(r.id) ?? []
        const probe = samples[0] ?? r.title
        const hits = repo.searchKb(await embed(probe), DEFAULT_DUP_TOP_K)
        const dup = isDuplicateOfHits(probe, hits, DEFAULT_DUP_MAX_DISTANCE)
        return {
          id: r.id,
          samples,
          kbCovered: dup.duplicate,
          kbDistance:
            dup.hit?.distance ?? (hits.length ? hits[0].distance : null),
        }
      }
    )
    const probeById = new Map(probes.map((p) => [p.id, p]))
    for (let idx = 0; idx < ranked.length; idx++) {
      const r = ranked[idx]
      questions += r.count
      const samples = samplesByTopic.get(r.id) ?? []
      // null = 未评估(排名 TOP_KB 之外不算 KB,避免误标盲区)
      let kbCovered: boolean | null = null
      let kbDistance: number | null = null
      if (idx < TOP_KB) {
        const p = probeById.get(r.id)!
        kbCovered = p.kbCovered
        kbDistance = p.kbDistance
        if (!kbCovered) gaps++
      }
      topics.push({
        id: r.id,
        title: r.title,
        count: r.count,
        kbCovered,
        kbDistance,
        lastTs: r.lastTs,
        samples,
      })
    }

    return NextResponse.json(
      ok({
        window,
        totals: {
          topics: fullTotals?.topics ?? ranked.length,
          questions: fullTotals?.questions ?? questions,
          gaps,
        },
        topics,
      })
    )
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
