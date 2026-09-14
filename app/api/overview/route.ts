import { NextResponse } from "next/server"
import { statSync } from "node:fs"
import { getAppContext } from "@/lib/core/app-context"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { filesystemDbPath } from "@/lib/core/db/path"

// status 页汇总卡 + 全局角标 + 结果指标
export async function GET(): Promise<NextResponse> {
  try {
    const { cfg, repo } = getAppContext()
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const since = dayStart.getTime()
    const counts = repo.resolutionCounts(since)
    const auto = counts.auto ?? 0
    const proactive = counts.proactive ?? 0
    const handoff = counts.handoff ?? 0
    const error = counts.error ?? 0
    const operationalErrors = counts.operational_error ?? 0
    const blocked = counts.blocked ?? 0
    // 合格自动解决率:后台运维错误只进 operationalErrors,不进入业务结果分母。
    const denom = auto + proactive + handoff + error
    const autoResolutionRate = denom > 0 ? auto / denom : null
    const day = new Date().toISOString().slice(0, 10)
    const usageCost = repo.usageDailyTotalCost(day)
    const proactiveBad = repo.proactiveBadCount(since)
    const outbox = repo.outbox.statusCounts()
    const storage = storageStats(cfg.dbPath)

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
          operationalErrors,
          blocked,
          proactiveSilent: counts.proactive_silent ?? 0,
          autoResolutionRate,
          proactiveBad,
          usageCostUsd: usageCost,
          usageBudgetUsd: cfg.usageBudgetUsd,
          outbox,
          storage,
        },
      })
    )
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}

function storageStats(path: string): {
  dbBytes: number
  walBytes: number
  shmBytes: number
} {
  const db = filesystemDbPath(path)
  if (!db) return { dbBytes: 0, walBytes: 0, shmBytes: 0 }
  return {
    dbBytes: fileSize(db),
    walBytes: fileSize(`${db}-wal`),
    shmBytes: fileSize(`${db}-shm`),
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
