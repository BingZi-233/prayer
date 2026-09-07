import { NextRequest, NextResponse } from "next/server"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig, setConfig } from "@/lib/config-store"
import { configPatchSchema, mergeConfigPatch } from "@/lib/config/patch"
import { getRuntime, defaultBuilders } from "@/lib/runtime"
import { ok, fail, maskConfig } from "@/lib/api"

function repo(): Repo {
  return new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
}

export async function GET(): Promise<NextResponse> {
  const cfg = getConfig(repo())
  return NextResponse.json(ok(maskConfig(cfg)))
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null)
  const parsed = configPatchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(fail("参数非法"), { status: 400 })

  const r = repo()
  const current = getConfig(r)
  const next = setConfig(r, mergeConfigPatch(current, parsed.data))

  const builders = await defaultBuilders()
  await getRuntime().reconfigure(next, builders)
  return NextResponse.json(ok(maskConfig(next)))
}
