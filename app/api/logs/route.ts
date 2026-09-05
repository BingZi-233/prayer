import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { ok } from "@/lib/api"

// raw 与 msg 相同的条目(captureConsole 捕获的 warn/error 一律 raw=msg)不重复下发:
// 前端只在 raw !== msg 时才展示原文,ring 里 2000 条每次全量回吐,重复字段纯浪费一倍体积
export async function GET(): Promise<NextResponse> {
  const entries = logger
    .tail()
    .map((e) => ({ ...e, raw: e.raw !== e.msg ? e.raw : undefined }))
  return NextResponse.json(ok(entries))
}
