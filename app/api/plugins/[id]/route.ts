import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAppContext } from "@/lib/core/app-context"
import type { AppConfig } from "@/lib/core/config-store"
import { getRuntime, defaultBuilders } from "@/lib/runtime"
import { PluginManager, type CliResult } from "@/lib/model/plugins/manager"
import { ok, fail } from "@/lib/core/api"

function manager(cfg: { claudeConfigDir: string }) {
  return new PluginManager(cfg.claudeConfigDir)
}
async function applyAndReconfigure(result: CliResult, cfg: AppConfig): Promise<NextResponse> {
  if (!result.ok)
    return NextResponse.json(fail(result.error ?? "操作失败"), { status: 500 })
  await getRuntime().reconfigure(cfg, await defaultBuilders())
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
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(fail("参数非法"), { status: 400 })
  try {
    const { cfg } = getAppContext()
    const m = manager(cfg)
    const r = await m[parsed.data.action](id)
    return applyAndReconfigure(r, cfg)
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params
  try {
    const { cfg } = getAppContext()
    const r = await manager(cfg).uninstall(id)
    return applyAndReconfigure(r, cfg)
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
