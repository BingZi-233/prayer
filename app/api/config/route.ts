import { NextRequest, NextResponse } from "next/server"
import { setConfig } from "@/lib/core/config-store"
import { getAppContext } from "@/lib/core/app-context"
import { configPatchSchema, mergeConfigPatch } from "@/lib/core/config/patch"
import { getRuntime, defaultBuilders } from "@/lib/runtime"
import { ok, fail, maskConfig } from "@/lib/core/api"

export async function GET(): Promise<NextResponse> {
  const { cfg } = getAppContext()
  return NextResponse.json(ok(maskConfig(cfg)))
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null)
  const parsed = configPatchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(fail("参数非法"), { status: 400 })

  const { configRepo, cfg: current } = getAppContext()
  const next = setConfig(configRepo, mergeConfigPatch(current, parsed.data))

  const builders = await defaultBuilders()
  await getRuntime().reconfigure(next, builders)
  return NextResponse.json(ok(maskConfig(next)))
}
