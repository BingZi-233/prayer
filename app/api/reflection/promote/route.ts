import { NextResponse } from "next/server"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { ok, fail } from "@/lib/api"
import { runPromote } from "@/lib/agent/reflection-promoter"
import { resolveAdminSurface } from "@/lib/channels/enabled-chats"

// 手动触发一轮自动升格评审(与定时任务同逻辑)
export async function POST(): Promise<NextResponse> {
  try {
    const cfg = getConfig(
      new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
    )
    const repo = new Repo(sharedDb(cfg.dbPath))
    const before = repo
      .reflectionEntries()
      .filter((e) => e.status === "approved").length
    const result = await runPromote({
      repo,
      adminSurface: resolveAdminSurface(cfg),
      minEntries: cfg.reflectPromoteMinEntries,
      maxPerRun: cfg.reflectPromoteMaxPerRun,
      notifyAdmin: cfg.reflectNotifyAdmin,
    })
    repo.setPromoteAt(Date.now())
    return NextResponse.json(
      ok({
        ran:
          result.promoted > 0 ||
          result.considered >= cfg.reflectPromoteMinEntries,
        considered: result.considered,
        promoted: result.promoted,
        candidatesBefore: before,
      })
    )
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
