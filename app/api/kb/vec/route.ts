import { NextRequest, NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { DIM } from "@/lib/core/db/index"
import { MAX_KB_PREVIEW_CHUNKS } from "@/lib/core/db/repo"
import { ok, fail, safeApiError } from "@/lib/core/api"

// 向量库预览:无 doc → 全库统计;带 ?doc=xxx → 该 doc 的分块内容
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { repo } = getAppContext()
    const doc = req.nextUrl.searchParams.get("doc")
    if (doc)
      return NextResponse.json(
        ok(repo.kbChunksByDoc(doc, MAX_KB_PREVIEW_CHUNKS))
      )
    const totals = repo.kbTotals()
    return NextResponse.json(
      ok({ ...totals, dim: DIM, docs: repo.kbDocStats() })
    )
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
