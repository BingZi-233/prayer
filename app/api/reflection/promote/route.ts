import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { runPromote } from "@/lib/knowledge/reflection/promoter"
import { resolveAdminSurface } from "@/lib/core/chat/enabled-chats"
import { emptyBodyFailure, readEmptyBody } from "@/lib/core/http-security"

// 手动触发一轮自动升格评审(与定时任务同逻辑)
export async function POST(req: Request): Promise<NextResponse> {
  const bodyFailure = emptyBodyFailure(await readEmptyBody(req))
  if (bodyFailure)
    return NextResponse.json(fail(bodyFailure.message), {
      status: bodyFailure.status,
    })
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
    if (result.failed)
      return NextResponse.json(fail("反思升格失败，请查看运维日志"), {
        status: 503,
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
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
