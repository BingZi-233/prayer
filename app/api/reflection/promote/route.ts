import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { ok, fail } from "@/lib/core/api"
import { runPromote } from "@/lib/knowledge/reflection/promoter"
import { resolveAdminSurface } from "@/lib/core/chat/enabled-chats"

// 手动触发一轮自动升格评审(与定时任务同逻辑)
export async function POST(): Promise<NextResponse> {
  try {
    const { cfg, repo } = getAppContext()
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
