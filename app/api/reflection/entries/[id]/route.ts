import { NextRequest, NextResponse } from "next/server"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { ok, fail } from "@/lib/api"

// 单条沉淀条目全文。列表接口只给预览截断(SQL 内截断),前端展开时才来这里拉,
// 避免每次轮询都带上全部条目的 content/question/answer 全文(compactions 同款修法)。
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params
    const n = Number(id)
    if (!Number.isInteger(n))
      return NextResponse.json(fail("参数非法"), { status: 400 })

    const cfg = getConfig(
      new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
    )
    const repo = new Repo(sharedDb(cfg.dbPath))
    const detail = repo.reflectionEntryDetail(n)
    if (!detail) return NextResponse.json(fail("条目不存在"), { status: 404 })
    return NextResponse.json(ok(detail))
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
