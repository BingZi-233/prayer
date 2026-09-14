import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { runIngest } from "@/scripts/ingest"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { emptyBodyFailure, readEmptyBody } from "@/lib/core/http-security"

export async function POST(req: Request): Promise<NextResponse> {
  const bodyFailure = emptyBodyFailure(await readEmptyBody(req))
  if (bodyFailure)
    return NextResponse.json(fail(bodyFailure.message), {
      status: bodyFailure.status,
    })
  try {
    const { repo } = getAppContext()
    const results = await runIngest(repo, "docs/kb")
    return NextResponse.json(ok(results))
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
