import { NextRequest, NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

function repo(): Repo {
  const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
  return new Repo(sharedDb(cfg.dbPath));
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(ok(repo().listSessions()));
}

// 会话重开:
//   {action:"reset_all"}        → 清所有会话 resume_id,每个会话下条消息各自开新对话。
//   {action:"reset", key:"g:u"} → 只清单个会话 resume_id。
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (body?.action === "reset_all") {
    const reset = repo().clearAllResumeIds();
    return NextResponse.json(ok({ reset }));
  }
  if (body?.action === "reset") {
    if (typeof body.key !== "string" || !body.key) return NextResponse.json(fail("缺少 key"), { status: 400 });
    repo().clearResumeId(body.key);
    return NextResponse.json(ok({ reset: 1 }));
  }
  return NextResponse.json(fail("参数非法"), { status: 400 });
}
