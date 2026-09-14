import { NextRequest, NextResponse } from "next/server"
import { readdirSync, mkdirSync, existsSync } from "node:fs"
import { dirname, sep } from "node:path"
import { z } from "zod"
import { ok, fail, safeApiError } from "@/lib/core/api"
import {
  KB_DIR,
  MAX_KB_FILE_BYTES,
  createKbFileNoFollow,
  isKbRelPath,
  safeKbAbs,
} from "@/lib/knowledge/kb-path"
import { readJsonBody, REQUEST_BODY_TOO_LARGE } from "@/lib/core/http-security"
import { withKbMutationLock } from "@/lib/knowledge/mutation-lock"

export async function GET(): Promise<NextResponse> {
  let files: string[] = []
  try {
    files = readdirSync(KB_DIR, { recursive: true })
      .map((f) => String(f).split(sep).join("/"))
      .filter(
        (f) =>
          (f.endsWith(".md") || f.endsWith(".txt")) && safeKbAbs(f) !== null
      )
      .sort()
  } catch (err) {
    // A fresh checkout may not have created docs/kb yet; that is an empty
    // corpus, but permission/I/O failures must not look like a healthy empty
    // result to the admin UI.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return NextResponse.json(fail(safeApiError(err, "知识库读取失败")), {
        status: 503,
      })
    }
  }
  return NextResponse.json(ok(files))
}

const createSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(512_000).optional(),
})

// 新建文档:自动建父目录;已存在则 409
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req)
  if (body === REQUEST_BODY_TOO_LARGE)
    return NextResponse.json(fail("请求体过大"), { status: 413 })
  const parsed = createSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(fail("参数非法"), { status: 400 })
  if (
    parsed.data.content !== undefined &&
    Buffer.byteLength(parsed.data.content, "utf8") > MAX_KB_FILE_BYTES
  )
    return NextResponse.json(fail("文件过大"), { status: 413 })

  return withKbMutationLock(async () => {
    try {
      const rel = parsed.data.path.replace(/^\/+/, "").split(sep).join("/")
      if (!isKbRelPath(rel))
        return NextResponse.json(fail("路径非法(仅 .md/.txt,禁止穿越)"), {
          status: 400,
        })
      const abs = safeKbAbs(rel)
      if (!abs) return NextResponse.json(fail("路径非法"), { status: 400 })
      if (existsSync(abs))
        return NextResponse.json(fail("文件已存在"), { status: 409 })
      mkdirSync(dirname(abs), { recursive: true })
      // Re-check after directory creation; a symlink swap must not redirect the
      // write outside the configured KB root.
      if (!safeKbAbs(rel))
        return NextResponse.json(fail("路径非法"), { status: 400 })
      if (!createKbFileNoFollow(abs, parsed.data.content ?? ""))
        return NextResponse.json(fail("文件已存在或路径不可用"), { status: 409 })
      return NextResponse.json(ok({ path: rel }))
    } catch (err) {
      return NextResponse.json(fail(safeApiError(err)), { status: 500 })
    }
  })
}
