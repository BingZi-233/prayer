import { NextResponse } from "next/server"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { ok, fail } from "@/lib/api"

// status 页汇总卡 + 全局角标 + 结果指标
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(
      new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
    )
    const repo = new Repo(sharedDb(cfg.dbPath))
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const since = dayStart.getTime()
    const counts = repo.resolutionCounts(since)
    const auto = counts.auto ?? 0
    const proactive = counts.proactive ?? 0
    const handoff = counts.handoff ?? 0
    const error = counts.error ?? 0
    const blocked = counts.blocked ?? 0
    // 合格自动解决率近似:自动答 / (自动答+主动+转人工+错误);不含 blocked/ack
    const denom = auto + proactive + handoff + error
    const autoResolutionRate = denom > 0 ? auto / denom : null
    const day = new Date().toISOString().slice(0, 10)
    const usageCost = repo.usageDailyTotalCost(day)
    const proactiveBad = repo.proactiveBadCount(since)

    return NextResponse.json(
      ok({
        brandName: cfg.brandName,
        brandDescription: cfg.brandDescription,
        enabledChats: cfg.enabledChats.length,
        reflectionCount: repo.countReflectionEntries(),
        humanSessions: repo.countHumanSessions(),
        // 结果指标(今日 0 点起)
        metrics: {
          since,
          auto,
          proactive,
          handoff,
          error,
          blocked,
          proactiveSilent: counts.proactive_silent ?? 0,
          autoResolutionRate,
          proactiveBad,
          usageCostUsd: usageCost,
          usageBudgetUsd: cfg.usageBudgetUsd,
        },
      })
    )
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
