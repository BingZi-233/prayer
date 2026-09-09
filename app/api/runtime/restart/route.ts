import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/app-context"
import { getRuntime, defaultBuilders } from "@/lib/runtime"
import { ok } from "@/lib/api"

export async function POST(): Promise<NextResponse> {
  const { cfg } = getAppContext()
  const builders = await defaultBuilders()
  await getRuntime().reconfigure(cfg, builders)
  return NextResponse.json(ok(getRuntime().getStatus()))
}
