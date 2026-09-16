import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { runCompactWithOutcome } from "@/lib/knowledge/reflection/compactor"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { resolveAdminSurface } from "@/lib/core/chat/enabled-chats"
import { emptyBodyFailure, readEmptyBody } from "@/lib/core/http-security"
import {
  markAdminAuditPartial,
  withAdminMutationAudit,
} from "@/lib/core/admin-audit-route"

// 手动触发一次反思整理:绕过到期判定,直接跑 runCompact(仍受 minEntries 阈值约束)。
// 同进程(Next server)已由 instrumentation 装配 runtime,process.env 的 CLAUDE_CONFIG_DIR/DB_PATH 就绪,
// runCompact 默认 embed/queryFn 可直接用;失败或保守部分提交均不推进游标。
export async function POST(req: Request): Promise<NextResponse> {
  const bodyFailure = emptyBodyFailure(await readEmptyBody(req))
  if (bodyFailure)
    return NextResponse.json(fail(bodyFailure.message), {
      status: bodyFailure.status,
    })
  try {
    const { cfg, repo } = getAppContext()
    return withAdminMutationAudit(
      repo,
      {
        action: "reflection.compact",
        route: "/api/reflection/compact",
        method: "POST",
      },
      async () => {
        try {
          const before = repo.reflectionEntries().length
          const outcome = await runCompactWithOutcome({
            repo,
            adminSurface: resolveAdminSurface(cfg),
            minEntries: cfg.reflectCompactMinEntries,
            notifyAdmin: cfg.reflectNotifyAdmin,
          })
          if (outcome !== "completed") {
            const response = NextResponse.json(
              fail("反思整理失败，请查看运维日志"),
              {
                status: 503,
              }
            )
            return outcome === "partial"
              ? markAdminAuditPartial(response)
              : response
          }
          repo.setCompactAt(Date.now()) // 手动整理也推进游标,避免紧接着定时任务重复跑
          const after = repo.reflectionEntries().length
          return NextResponse.json(ok({ before, after, ran: after !== before }))
        } catch (err) {
          return NextResponse.json(fail(safeApiError(err)), { status: 500 })
        }
      }
    )
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
