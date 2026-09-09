import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAppContext } from "@/lib/app-context"
import { getRuntime, defaultBuilders } from "@/lib/runtime"
import { PluginManager, type CliResult } from "@/lib/plugins/manager"
import { ok, fail } from "@/lib/api"

function manager() {
  return new PluginManager(getAppContext().cfg.claudeConfigDir)
}
async function applyAndReconfigure(result: CliResult): Promise<NextResponse> {
  if (!result.ok)
    return NextResponse.json(fail(result.error ?? "操作失败"), { status: 500 })
  const { cfg: c } = getAppContext()
  await getRuntime().reconfigure(c, await defaultBuilders())
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
    const m = manager()
    const r = await m[parsed.data.action](id)
    return applyAndReconfigure(r)
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
    const r = await manager().uninstall(id)
    return applyAndReconfigure(r)
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
