import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAppContext } from "@/lib/core/app-context"
import type { AppConfig } from "@/lib/core/config-store"
import {
  getRuntime,
  defaultBuilders,
  runtimeFailureMessage,
  serializeRuntimeMutation,
} from "@/lib/runtime"
import {
  bestEffortPluginRollback,
  PluginManager,
  type CliResult,
  type PluginRollback,
} from "@/lib/model/plugins/manager"
import { ok, fail, safeApiError } from "@/lib/core/api"
import {
  emptyBodyFailure,
  readEmptyBody,
  readJsonBody,
  REQUEST_BODY_TOO_LARGE,
} from "@/lib/core/http-security"
import { redactSensitive } from "@/lib/core/log-context"
import { logger } from "@/lib/core/logger"

function manager(cfg: { claudeConfigDir: string }) {
  return new PluginManager(cfg.claudeConfigDir)
}
async function applyAndReconfigure(
  result: CliResult,
  cfg: AppConfig,
  rollback?: PluginRollback,
  rollbackUnavailable?: string
): Promise<NextResponse> {
  if (!result.ok)
    return NextResponse.json(fail(result.error ?? "操作失败"), { status: 500 })
  const runtime = getRuntime()
  let failure: string | undefined
  try {
    await runtime.reconfigure(cfg, await defaultBuilders())
    failure = runtimeFailureMessage(runtime.getStatus())
  } catch (err) {
    failure = safeApiError(err)
  }
  if (failure) {
    const rollbackResult = await bestEffortPluginRollback(rollback)
    let recoveryFailure: string | undefined
    if (rollbackResult?.ok) {
      try {
        // The failed reconfigure may have already torn down the old runtime.
        // Re-apply the now-restored plugin state before returning the error.
        await runtime.reconfigure(cfg, await defaultBuilders())
        recoveryFailure = runtimeFailureMessage(runtime.getStatus())
      } catch (err) {
        recoveryFailure = safeApiError(err)
      }
    }
    const rollbackMessage = rollback
      ? rollbackResult?.ok
        ? recoveryFailure
          ? `；插件操作已回滚，但运行时恢复失败：${redactSensitive(
              recoveryFailure
            ).slice(0, 100)}`
          : "；插件操作已回滚，运行时已恢复"
        : `；插件回滚失败：${redactSensitive(
            rollbackResult?.error ?? "未知错误"
          ).slice(0, 100)}`
      : rollbackUnavailable
        ? `；${rollbackUnavailable}`
        : ""
    logger.error(`[plugins] 运行时重载失败: ${redactSensitive(failure)}`, {
      scope: "plugin.rollback",
      raw: rollbackResult?.error,
    })
    return NextResponse.json(
      fail(
        `运行时未能应用插件变更：${redactSensitive(failure).slice(0, 160)}${rollbackMessage}`
      ),
      { status: 503 }
    )
  }
  return NextResponse.json(ok(true))
}

const patchSchema = z.object({
  action: z.enum(["enable", "disable", "update"]),
})

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params
  const body = await readJsonBody(req)
  if (body === REQUEST_BODY_TOO_LARGE)
    return NextResponse.json(fail("请求体过大"), { status: 413 })
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(fail("参数非法"), { status: 400 })
  return serializeRuntimeMutation(async () => {
    try {
      const { cfg } = getAppContext()
      const m = manager(cfg)
      const before = await m.find(id)
      if (!before)
        return NextResponse.json(fail("插件不存在"), { status: 404 })
      // Idempotent toggles must not run an inverse action on an already-correct
      // state; the previous implementation could flip a no-op back on rollback.
      if (
        parsed.data.action !== "update" &&
        before.enabled === (parsed.data.action === "enable")
      )
        return NextResponse.json(ok(true))
      const r = await m[parsed.data.action](id)
      const rollback: PluginRollback | undefined =
        parsed.data.action === "enable"
          ? () => m.restoreEnabled(before)
          : parsed.data.action === "disable"
            ? () => m.restoreEnabled(before)
            : undefined
      return applyAndReconfigure(
        r,
        cfg,
        rollback,
        parsed.data.action === "update"
          ? "update 无法自动回滚，请检查插件版本与运行时状态"
          : undefined
      )
    } catch (err) {
      return NextResponse.json(fail(safeApiError(err)), { status: 500 })
    }
  })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const bodyFailure = emptyBodyFailure(await readEmptyBody(req))
  if (bodyFailure)
    return NextResponse.json(fail(bodyFailure.message), {
      status: bodyFailure.status,
    })
  const { id } = await ctx.params
  return serializeRuntimeMutation(async () => {
    try {
      const { cfg } = getAppContext()
      const m = manager(cfg)
      const before = await m.find(id)
      if (!before)
        return NextResponse.json(fail("插件不存在"), { status: 404 })
      const r = await m.uninstall(id)
      return applyAndReconfigure(
        r,
        cfg,
        undefined,
        "卸载无法精确自动回滚：Claude CLI 不支持按原版本恢复，请确认版本后手动重新安装"
      )
    } catch (err) {
      return NextResponse.json(fail(safeApiError(err)), { status: 500 })
    }
  })
}
