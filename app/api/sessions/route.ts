import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { ok, fail } from "@/lib/api"
import { bus } from "@/lib/bus"

function sessionContext(): { repo: Repo; resumeTtlMs: number } {
  const cfg = getConfig(
    new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
  )
  return { repo: new Repo(sharedDb(cfg.dbPath)), resumeTtlMs: cfg.resumeTtlMs }
}

export async function GET(): Promise<NextResponse> {
  try {
    const { repo: sessionRepo, resumeTtlMs } = sessionContext()
    // 虚拟滚动列表用不到全量历史;会话表随 (群,用户) 只增不减,给个上限防逐年变重
    return NextResponse.json(
      ok(sessionRepo.listSessions(resumeTtlMs, Date.now(), 500))
    )
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}

// 会话操作:
//   {action:"reset_all"}              → 清所有会话 resume_id
//   {action:"reset", key:"g:u"}       → 清单个会话 resume_id
//   {action:"resume_handoff", key}    → 恢复自动答(关 human_mode)
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset_all") }),
  z.object({ action: z.literal("reset"), key: z.string().min(1) }),
  z.object({ action: z.literal("resume_handoff"), key: z.string().min(1) }),
])

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null)
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json(fail("参数非法"), { status: 400 })
    const { repo } = sessionContext()

    if (parsed.data.action === "reset_all") {
      const reset = repo.clearAllResumeIds()
      return NextResponse.json(ok({ reset }))
    }
    if (parsed.data.action === "reset") {
      repo.clearResumeId(parsed.data.key)
      return NextResponse.json(ok({ reset: 1 }))
    }
    bus.emit("handoff.resumed", { sessionKey: parsed.data.key, by: "admin" })
    return NextResponse.json(ok({ resumed: 1 }))
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
