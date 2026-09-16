import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import {
  getRuntime,
  defaultBuilders,
  runtimeFailureMessage,
  serializeRuntimeMutation,
} from "@/lib/runtime"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { redactSensitive } from "@/lib/core/log-context"
import { emptyBodyFailure, readEmptyBody } from "@/lib/core/http-security"
import { withAdminMutationAudit } from "@/lib/core/admin-audit-route"

export async function POST(req: Request): Promise<NextResponse> {
  const bodyFailure = emptyBodyFailure(await readEmptyBody(req))
  if (bodyFailure)
    return NextResponse.json(fail(bodyFailure.message), {
      status: bodyFailure.status,
    })
  let auditRepo: ReturnType<typeof getAppContext>["repo"]
  try {
    auditRepo = getAppContext().repo
  } catch (err) {
    return NextResponse.json(fail(`运行时重启失败：${safeApiError(err)}`), {
      status: 500,
    })
  }
  return withAdminMutationAudit(
    auditRepo,
    {
      action: "runtime.restart",
      route: "/api/runtime/restart",
      method: "POST",
    },
    () =>
      serializeRuntimeMutation(async () => {
        try {
          const { cfg } = getAppContext()
          const builders = await defaultBuilders()
          const runtime = getRuntime()
          await runtime.reconfigure(cfg, builders)
          const status = runtime.getStatus()
          const failure = runtimeFailureMessage(status)
          if (failure) {
            return NextResponse.json(
              fail(`运行时重启失败：${redactSensitive(failure).slice(0, 300)}`),
              { status: 503 }
            )
          }
          return NextResponse.json(ok(status))
        } catch (err) {
          const detail = safeApiError(err)
          return NextResponse.json(fail(`运行时重启失败：${detail}`), {
            status: 500,
          })
        }
      })
  )
}
