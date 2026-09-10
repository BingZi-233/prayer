import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { runIngest } from "@/scripts/ingest"
import { ok, fail } from "@/lib/core/api"

export async function POST(): Promise<NextResponse> {
  try {
    const { repo } = getAppContext()
    const results = await runIngest(repo, "docs/kb")
    return NextResponse.json(ok(results))
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
