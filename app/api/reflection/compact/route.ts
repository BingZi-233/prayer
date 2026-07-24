import { NextResponse } from "next/server"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { runCompact } from "@/lib/agent/reflection-compactor"
import { ok, fail } from "@/lib/api"
import { resolveAdminSurface } from "@/lib/channels/enabled-chats"

// 手动触发一次反思整理:绕过到期判定,直接跑 runCompact(仍受 minEntries 阈值约束)。
// 同进程(Next server)已由 instrumentation 装配 runtime,process.env 的 CLAUDE_CONFIG_DIR/DB_PATH 就绪,
// runCompact 默认 embed/queryFn 可直接用。runCompact 自吞异常不抛,故以前后条数差判断是否实际整理。
export async function POST(): Promise<NextResponse> {
  try {
    const cfg = getConfig(
      new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
    )
    const repo = new Repo(sharedDb(cfg.dbPath))
    const before = repo.reflectionEntries().length
    await runCompact({
      repo,
      adminSurface: resolveAdminSurface(cfg),
      minEntries: cfg.reflectCompactMinEntries,
      notifyAdmin: cfg.reflectNotifyAdmin,
    })
    repo.setCompactAt(Date.now()) // 手动整理也推进游标,避免紧接着定时任务重复跑
    const after = repo.reflectionEntries().length
    return NextResponse.json(ok({ before, after, ran: after !== before }))
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
