import { NextRequest, NextResponse } from "next/server"
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
  const { repo: sessionRepo, resumeTtlMs } = sessionContext()
  return NextResponse.json(ok(sessionRepo.listSessions(resumeTtlMs)))
}

// 会话操作:
//   {action:"reset_all"}              → 清所有会话 resume_id
//   {action:"reset", key:"g:u"}       → 清单个会话 resume_id
//   {action:"resume_handoff", key}    → 恢复自动答(关 human_mode)
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null)
  if (body?.action === "reset_all") {
    const { repo } = sessionContext()
    const reset = repo.clearAllResumeIds()
    return NextResponse.json(ok({ reset }))
  }
  if (body?.action === "reset") {
    if (typeof body.key !== "string" || !body.key)
      return NextResponse.json(fail("缺少 key"), { status: 400 })
    sessionContext().repo.clearResumeId(body.key)
    return NextResponse.json(ok({ reset: 1 }))
  }
  if (body?.action === "resume_handoff") {
    if (typeof body.key !== "string" || !body.key)
      return NextResponse.json(fail("缺少 key"), { status: 400 })
    bus.emit("handoff.resumed", { sessionKey: body.key, by: "admin" })
    return NextResponse.json(ok({ resumed: 1 }))
  }
  return NextResponse.json(fail("参数非法"), { status: 400 })
}
