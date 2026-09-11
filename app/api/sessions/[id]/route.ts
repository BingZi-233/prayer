import { NextRequest, NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { readTranscript } from "@/lib/conversation/transcript"
import { ok } from "@/lib/core/api"

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params
  const { cfg } = getAppContext()
  const msgs = readTranscript(cfg.claudeConfigDir, id)
  return NextResponse.json(ok(msgs))
}
