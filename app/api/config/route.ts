import { NextRequest, NextResponse } from "next/server"
import { setConfig } from "@/lib/core/config-store"
import { getAppContext } from "@/lib/core/app-context"
import { configPatchSchema, mergeConfigPatch } from "@/lib/core/config/patch"
import {
  getRuntime,
  defaultBuilders,
  runtimeFailureMessage,
  serializeRuntimeMutation,
} from "@/lib/runtime"
import { ok, fail, maskConfig, safeApiError } from "@/lib/core/api"
import { readJsonBody, REQUEST_BODY_TOO_LARGE } from "@/lib/core/http-security"
import { logger } from "@/lib/core/logger"
import { canonicalDbPath } from "@/lib/core/db/shared"

export async function GET(): Promise<NextResponse> {
  try {
    const { cfg } = getAppContext()
    return NextResponse.json(ok(maskConfig(cfg)))
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req)
  if (body === REQUEST_BODY_TOO_LARGE)
    return NextResponse.json(fail("请求体过大"), { status: 413 })
  const parsed = configPatchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(fail("参数非法"), { status: 400 })

  return serializeRuntimeMutation(async () => {
    let persisted = false
    let runtimeAttempted = false
    let runtime: ReturnType<typeof getRuntime> | undefined
    let builders: Awaited<ReturnType<typeof defaultBuilders>> | undefined
    let configRepo: ReturnType<typeof getAppContext>["configRepo"] | undefined
    let current: ReturnType<typeof getAppContext>["cfg"] | undefined
    try {
      const app = getAppContext()
      configRepo = app.configRepo
      current = app.cfg
      // 数据库位置是部署级边界。允许管理面在线切换会让配置仓储和业务仓储
      // 分叉，甚至把运行时指向任意可写路径；兼容旧客户端回传同一路径。
      if (
        parsed.data.dbPath !== undefined &&
        canonicalDbPath(parsed.data.dbPath) !== canonicalDbPath(current.dbPath)
      ) {
        return NextResponse.json(
          fail("数据库路径由部署环境中的 DB_PATH 管理，不能在线修改"),
          { status: 400 }
        )
      }
      const next = setConfig(configRepo, mergeConfigPatch(current, parsed.data))
      persisted = true
      builders = await defaultBuilders()
      runtime = getRuntime()
      runtimeAttempted = true
      await runtime.reconfigure(next, builders)
      const status = runtime.getStatus()
      // channel.start() 的拒绝会被 Runtime 吸收为 degraded；有明确错误时仍
      // 视为本次配置未应用，不能把坏配置留在 SQLite。仅“正在连接、尚无错误”
      // 的 degraded 允许返回成功，由 readiness 探针继续观察。
      const failure = runtimeFailureMessage(status)
      if (failure) throw new Error(failure)
      return NextResponse.json(ok(maskConfig(next)))
    } catch (err) {
      let rollbackError: unknown
      if (persisted && configRepo && current) {
        try {
          // 配置落库与运行时重载不是同一个事务；运行时失败时恢复旧配置，
          // 并尽力把旧配置重新装配，避免下次重启继续带着坏配置启动。
          setConfig(configRepo, current)
          if (runtimeAttempted && runtime && builders) {
            await runtime.reconfigure(current, builders)
            const rollbackStatus = runtime.getStatus()
            const failure = runtimeFailureMessage(rollbackStatus)
            if (failure) throw new Error(failure)
          }
        } catch (rollbackErr) {
          rollbackError = rollbackErr
        }
      }
      const detail = safeApiError(err)
      const suffix = rollbackError ? "；旧配置恢复也失败，请立即检查运行时" : ""
      logger.error(`[config] 配置应用失败: ${detail}${suffix}`, {
        scope: "config.reconfigure",
        raw: rollbackError ? safeApiError(rollbackError) : undefined,
      })
      return NextResponse.json(
        fail(
          `配置未生效，${persisted ? "已回滚" : "未写入"}：${detail}${suffix}`
        ),
        { status: runtimeAttempted ? 503 : 500 }
      )
    }
  })
}
