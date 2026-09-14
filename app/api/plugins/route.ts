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
  isValidPluginRef,
  PluginManager,
  type CliResult,
  type MarketplaceInfo,
  type PluginRollback,
} from "@/lib/model/plugins/manager"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { readJsonBody, REQUEST_BODY_TOO_LARGE } from "@/lib/core/http-security"
import { redactSensitive } from "@/lib/core/log-context"
import { logger } from "@/lib/core/logger"

function manager(cfg: { claudeConfigDir: string }) {
  return new PluginManager(cfg.claudeConfigDir)
}

function sameMarketplaceSource(
  marketplace: MarketplaceInfo,
  source: "github" | "directory",
  value: string
): boolean {
  return source === "github"
    ? marketplace.source === "github" && marketplace.repo === value
    : marketplace.source === "directory" && marketplace.path === value
}

async function applyAndReconfigure(
  result: CliResult,
  cfg: AppConfig,
  rollback?: PluginRollback
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
        // A failed reconfigure can leave the old runtime stopped; restart it
        // after restoring the plugin filesystem state.
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

export async function GET(): Promise<NextResponse> {
  try {
    const { cfg } = getAppContext()
    return NextResponse.json(ok(await manager(cfg).list()))
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}

const postSchema = z.object({
  source: z.enum(["github", "directory"]),
  repoOrPath: z.string().min(1),
  marketplaceName: z.string().min(1),
  pluginName: z.string().min(1),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req)
  if (body === REQUEST_BODY_TOO_LARGE)
    return NextResponse.json(fail("请求体过大"), { status: 413 })
  const parsed = postSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(fail("参数非法"), { status: 400 })
  const { repoOrPath, marketplaceName, pluginName } = parsed.data
  if (!isValidPluginRef(pluginName) || !isValidPluginRef(marketplaceName))
    return NextResponse.json(fail("插件或 marketplace 名称非法"), { status: 400 })

  return serializeRuntimeMutation(async () => {
    let marketplaceCleanup: PluginRollback | undefined
    let installed = false
    let applied = false
    let rollbackAfterInstall: PluginRollback | undefined
    try {
      const { cfg } = getAppContext()
      const m = manager(cfg)

      const ref = `${pluginName}@${marketplaceName}`
      if (await m.find(ref))
        return NextResponse.json(fail("插件已安装，拒绝覆盖既有安装状态"), {
          status: 409,
        })

      const existingMarketplace = (await m.listMarketplaces()).find(
        (marketplace) => marketplace.name === marketplaceName
      )
      if (
        existingMarketplace &&
        !sameMarketplaceSource(existingMarketplace, parsed.data.source, repoOrPath)
      )
        return NextResponse.json(
          fail("同名 marketplace 已存在但来源不同，拒绝覆盖"),
          { status: 409 }
        )

      if (!existingMarketplace) {
        const added = await m.addMarketplace(repoOrPath)
        if (!added.ok)
          return NextResponse.json(
            fail(added.error ?? "添加 marketplace 失败"),
            { status: 500 }
          )
        // Only remove a marketplace that this request added. Existing sources
        // are deliberately left untouched on every failure path.
        marketplaceCleanup = () => m.removeMarketplace(marketplaceName)
      }

      const installResult = await m.install(pluginName, marketplaceName)
      if (!installResult.ok) {
        const cleanup = await bestEffortPluginRollback(marketplaceCleanup)
        const cleanupMessage =
          cleanup && !cleanup.ok ? "；新 marketplace 清理失败，请手动检查" : ""
        return NextResponse.json(
          fail(`${installResult.error ?? "安装失败"}${cleanupMessage}`),
          { status: 500 }
        )
      }
      installed = true
      rollbackAfterInstall = async () => {
        const removed = await m.uninstall(ref)
        if (!removed.ok) return removed
        return (await bestEffortPluginRollback(marketplaceCleanup)) ?? { ok: true }
      }

      const appliedResponse = await applyAndReconfigure(
        installResult,
        cfg,
        rollbackAfterInstall
      )
      if (appliedResponse.status !== 200) return appliedResponse
      applied = true
      return NextResponse.json(ok(await m.list()))
    } catch (err) {
      // The normal CLI error paths above clean up deterministically. This is
      // only for unexpected exceptions (for example a parser/runtime fault).
      // Never remove an existing marketplace, and never hide cleanup failure.
      if (!applied) {
        const cleanup = installed
          ? await bestEffortPluginRollback(rollbackAfterInstall)
          : await bestEffortPluginRollback(marketplaceCleanup)
        if (cleanup && !cleanup.ok)
          return NextResponse.json(
            fail(`${safeApiError(err)}；插件变更清理失败，请手动检查`),
            { status: 500 }
          )
      }
      return NextResponse.json(fail(safeApiError(err)), { status: 500 })
    }
  })
}
