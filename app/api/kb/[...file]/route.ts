import { NextRequest, NextResponse } from "next/server"
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  renameSync,
  mkdirSync,
} from "node:fs"
import { dirname } from "node:path"
import { z } from "zod"
import { ok, fail } from "@/lib/api"
import { isKbRelPath, relFromParts, safeKbAbs } from "@/lib/kb-path"
import { getAppContext } from "@/lib/app-context"

// catch-all 段:file 为路径片段数组(如 ["faq","退款.md"]),支持子目录
function resolveRel(parts: string[]): { rel: string; abs: string } | null {
  const rel = relFromParts(parts)
  const abs = safeKbAbs(rel)
  if (!abs) return null
  return { rel, abs }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> }
): Promise<NextResponse> {
  const { file } = await ctx.params
  const r = resolveRel(file)
  if (!r || !existsSync(r.abs))
    return NextResponse.json(fail("文件不存在"), { status: 404 })
  return NextResponse.json(ok(readFileSync(r.abs, "utf8")))
}

const bodySchema = z.object({ content: z.string() })

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> }
): Promise<NextResponse> {
  const { file } = await ctx.params
  const r = resolveRel(file)
  if (!r) return NextResponse.json(fail("文件名非法"), { status: 400 })
  if (!existsSync(r.abs))
    return NextResponse.json(fail("文件不存在"), { status: 404 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json(fail("参数非法"), { status: 400 })
  writeFileSync(r.abs, parsed.data.content, "utf8")
  return NextResponse.json(ok(true))
}

const renameSchema = z.object({ newPath: z.string().min(1) })

// 重命名/移动:改磁盘 + 同步 kb_chunks.doc
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> }
): Promise<NextResponse> {
  try {
    const { file } = await ctx.params
    const r = resolveRel(file)
    if (!r) return NextResponse.json(fail("文件名非法"), { status: 400 })
    if (!existsSync(r.abs))
      return NextResponse.json(fail("文件不存在"), { status: 404 })
    const parsed = renameSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success)
      return NextResponse.json(fail("参数非法"), { status: 400 })
    const newRel = parsed.data.newPath.replace(/^\/+/, "").replace(/\\/g, "/")
    if (!isKbRelPath(newRel))
      return NextResponse.json(fail("新路径非法"), { status: 400 })
    const newAbs = safeKbAbs(newRel)
    if (!newAbs) return NextResponse.json(fail("新路径非法"), { status: 400 })
    if (newRel === r.rel) return NextResponse.json(ok({ path: r.rel }))
    if (existsSync(newAbs))
      return NextResponse.json(fail("目标已存在"), { status: 409 })
    mkdirSync(dirname(newAbs), { recursive: true })
    renameSync(r.abs, newAbs)
    const { repo: dbRepo } = getAppContext()
    dbRepo.renameKbDoc(r.rel, newRel)
    return NextResponse.json(ok({ path: newRel }))
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}

// 删除文件 + 清向量库中该 doc 分块
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> }
): Promise<NextResponse> {
  try {
    const { file } = await ctx.params
    const r = resolveRel(file)
    if (!r) return NextResponse.json(fail("文件名非法"), { status: 400 })
    if (!existsSync(r.abs))
      return NextResponse.json(fail("文件不存在"), { status: 404 })
    unlinkSync(r.abs)
    const { repo: dbRepo } = getAppContext()
    const purged = dbRepo.deleteKbDoc(r.rel)
    return NextResponse.json(ok({ path: r.rel, purged }))
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
