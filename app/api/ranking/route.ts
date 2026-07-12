import { NextRequest, NextResponse } from "next/server"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { ok, fail } from "@/lib/api"
import { embed } from "@/lib/tools/embed"
import {
  isDuplicateOfHits,
  DEFAULT_DUP_TOP_K,
  DEFAULT_DUP_MAX_DISTANCE,
} from "@/lib/agent/reflection-poller"

// 窗口 → 起始时间戳(ms)。all → 0。
function sinceTs(window: string, now: number): number {
  if (window === "30d") return now - 30 * 86_400_000
  if (window === "all") return 0
  return now - 7 * 86_400_000 // 默认 7d
}

const TOP_KB = 30 // 只对前 N 主题算 KB 命中,控制 embedding 次数

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const cfg = getConfig(
      new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
    )
    const repo = new Repo(sharedDb(cfg.dbPath))
    const now = Date.now()
    const raw = req.nextUrl.searchParams.get("window") ?? "7d"
    const window = raw === "30d" || raw === "all" ? raw : "7d"
    const since = sinceTs(window, now)

    const ranked = repo.rankingByWindow(since)
    const topics = []
    let gaps = 0
    let questions = 0
    for (let idx = 0; idx < ranked.length; idx++) {
      const r = ranked[idx]
      questions += r.count
      const samples = repo.topicSamples(r.id, 5, since)
      // null = 未评估(排名 TOP_KB 之外不算 KB,避免误标盲区)
      let kbCovered: boolean | null = null
      let kbDistance: number | null = null
      if (idx < TOP_KB) {
        const probe = samples[0] ?? r.title
        const hits = repo.searchKb(await embed(probe), DEFAULT_DUP_TOP_K)
        const dup = isDuplicateOfHits(probe, hits, DEFAULT_DUP_MAX_DISTANCE)
        kbCovered = dup.duplicate
        kbDistance =
          dup.hit?.distance ?? (hits.length ? hits[0].distance : null)
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
        totals: { topics: ranked.length, questions, gaps },
        topics,
      })
    )
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
