import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { runPromote } from "@/lib/knowledge/reflection/promoter"
import { resolveAdminSurface } from "@/lib/core/chat/enabled-chats"
import { emptyBodyFailure, readEmptyBody } from "@/lib/core/http-security"
import {
  markAdminAuditPartial,
  withAdminMutationAudit,
} from "@/lib/core/admin-audit-route"

// 手动触发一轮自动升格评审(与定时任务同逻辑)
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
        action: "reflection.promote",
        route: "/api/reflection/promote",
        method: "POST",
      },
      async () => {
        try {
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
          if (result.failed) {
            const response = NextResponse.json(
              fail(
                // 本轮可能有部分条目已落盘入库,一律报"失败"会让操作员误以为一条没成。
                // 不给 N/M 比例:considered 是候选总数(maxPerRun 会截断),做分母会给出错的比例。
                result.promoted > 0
                  ? `升格部分失败：本轮已升格 ${result.promoted} 条，其余见运维日志`
                  : "反思升格失败，请查看运维日志"
              ),
              { status: 503 }
            )
            return result.promoted > 0
              ? markAdminAuditPartial(response)
              : response
          }
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
    )
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
