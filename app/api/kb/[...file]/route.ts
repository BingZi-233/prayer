import { NextRequest, NextResponse } from "next/server"
import { existsSync, unlinkSync, renameSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { ok, fail, safeApiError } from "@/lib/core/api"
import {
  isKbRelPath,
  MAX_KB_FILE_BYTES,
  readKbFileBoundedNoFollow,
  relFromParts,
  safeKbAbs,
  writeKbFileNoFollow,
} from "@/lib/knowledge/kb-path"
import { getAppContext } from "@/lib/core/app-context"
import {
  emptyBodyFailure,
  readEmptyBody,
  readJsonBody,
  REQUEST_BODY_TOO_LARGE,
} from "@/lib/core/http-security"
import { withKbMutationLock } from "@/lib/knowledge/mutation-lock"

// catch-all 段:file 为路径片段数组(如 ["faq","退款.md"]),支持子目录
function resolveRel(parts: string[]): { rel: string; abs: string } | null {
  const rel = relFromParts(parts)
  const abs = safeKbAbs(rel)
  if (!abs) return null
  return { rel, abs }
}

/** Sibling staging names use .tmp so an interrupted mutation is not ingestible. */
function siblingStage(abs: string, prefix: string): string {
  return join(dirname(abs), `.${prefix}-${randomUUID()}.tmp`)
}

function rollbackRename(from: string, to: string): boolean {
  try {
    if (existsSync(to) || !existsSync(from)) return false
    renameSync(from, to)
    return true
  } catch {
    return false
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> }
): Promise<NextResponse> {
  try {
    const { file } = await ctx.params
    const r = resolveRel(file)
    if (!r || !existsSync(r.abs))
      return NextResponse.json(fail("文件不存在"), { status: 404 })
    // Re-check immediately before opening the file so a symlink swap between
    // resolve/existsSync and readFileSync cannot escape the KB root.
    if (!safeKbAbs(r.rel))
      return NextResponse.json(fail("文件不存在"), { status: 404 })
    const content = readKbFileBoundedNoFollow(r.abs, MAX_KB_FILE_BYTES)
    if (content === null)
      return NextResponse.json(fail("文件不存在"), { status: 404 })
    if ("tooLarge" in content)
      return NextResponse.json(fail("文件过大"), { status: 413 })
    return NextResponse.json(ok(content.content))
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}

const bodySchema = z.object({ content: z.string().max(512_000) })

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> }
): Promise<NextResponse> {
  try {
    const { file } = await ctx.params
    const body = await readJsonBody(req)
    if (body === REQUEST_BODY_TOO_LARGE)
      return NextResponse.json(fail("请求体过大"), { status: 413 })
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json(fail("参数非法"), { status: 400 })
    if (Buffer.byteLength(parsed.data.content, "utf8") > MAX_KB_FILE_BYTES)
      return NextResponse.json(fail("文件过大"), { status: 413 })
    return withKbMutationLock(async () => {
      try {
        const r = resolveRel(file)
        if (!r) return NextResponse.json(fail("文件名非法"), { status: 400 })
        // Re-check existence/path safety after waiting for other KB writers.
        if (!existsSync(r.abs))
          return NextResponse.json(fail("文件不存在"), { status: 404 })
        if (!safeKbAbs(r.rel))
          return NextResponse.json(fail("文件名非法"), { status: 400 })
        if (!writeKbFileNoFollow(r.abs, parsed.data.content))
          return NextResponse.json(fail("文件不存在"), { status: 404 })
        return NextResponse.json(ok(true))
      } catch (err) {
        return NextResponse.json(fail(safeApiError(err)), { status: 500 })
      }
    })
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}

const renameSchema = z.object({ newPath: z.string().min(1).max(512) })

// 重命名/移动:改磁盘 + 同步 kb_chunks.doc
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> }
): Promise<NextResponse> {
  try {
    const { file } = await ctx.params
    const body = await readJsonBody(req)
    if (body === REQUEST_BODY_TOO_LARGE)
      return NextResponse.json(fail("请求体过大"), { status: 413 })
    const parsed = renameSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json(fail("参数非法"), { status: 400 })
    return withKbMutationLock(async () => {
      try {
        const r = resolveRel(file)
        if (!r) return NextResponse.json(fail("文件名非法"), { status: 400 })
        const newRel = parsed.data.newPath
          .replace(/^\/+/, "")
          .replace(/\\/g, "/")
        if (!isKbRelPath(newRel))
          return NextResponse.json(fail("新路径非法"), { status: 400 })
        const newAbs = safeKbAbs(newRel)
        if (!newAbs)
          return NextResponse.json(fail("新路径非法"), { status: 400 })
        // Re-check both paths after waiting for other KB writers.
        if (!existsSync(r.abs))
          return NextResponse.json(fail("文件不存在"), { status: 404 })
        if (!safeKbAbs(r.rel))
          return NextResponse.json(fail("文件不存在"), { status: 404 })
        if (newRel === r.rel) return NextResponse.json(ok({ path: r.rel }))
        if (existsSync(newAbs))
          return NextResponse.json(fail("目标已存在"), { status: 409 })
        // Validate both sides before creating any parent directories; the second
        // check below closes the ordinary symlink-swap window after mkdir.
        if (!safeKbAbs(newRel) || !safeKbAbs(r.rel))
          return NextResponse.json(fail("路径非法"), { status: 400 })
        mkdirSync(dirname(newAbs), { recursive: true })
        if (!safeKbAbs(newRel) || !safeKbAbs(r.rel))
          return NextResponse.json(fail("路径非法"), { status: 400 })
        renameSync(r.abs, newAbs)
        try {
          const { repo: dbRepo } = getAppContext()
          dbRepo.renameKbDoc(r.rel, newRel)
        } catch (err) {
          // The repository update is the second half of this mutation.  Put the
          // file back before surfacing the error so disk and index do not diverge.
          if (!rollbackRename(newAbs, r.abs))
            throw new Error("知识库数据库同步失败且文件回滚失败，请运行 freshness 检查")
          throw err
        }
        return NextResponse.json(ok({ path: newRel }))
      } catch (err) {
        return NextResponse.json(fail(safeApiError(err)), { status: 500 })
      }
    })
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}

// 删除文件 + 清向量库中该 doc 分块
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ file: string[] }> }
): Promise<NextResponse> {
  try {
    const bodyFailure = emptyBodyFailure(await readEmptyBody(req))
    if (bodyFailure)
      return NextResponse.json(fail(bodyFailure.message), {
        status: bodyFailure.status,
      })
    const { file } = await ctx.params
    return withKbMutationLock(async () => {
      try {
        const r = resolveRel(file)
        if (!r) return NextResponse.json(fail("文件名非法"), { status: 400 })
        if (!existsSync(r.abs))
          return NextResponse.json(fail("文件不存在"), { status: 404 })
        if (!safeKbAbs(r.rel))
          return NextResponse.json(fail("文件不存在"), { status: 404 })
        // Move to a non-ingestible sibling first.  If the DB transaction fails we
        // can restore the original inode without loading a potentially large file.
        const stage = siblingStage(r.abs, "prayer-kb-delete")
        renameSync(r.abs, stage)
        let purged: number
        try {
          const { repo: dbRepo } = getAppContext()
          purged = dbRepo.deleteKbDoc(r.rel)
        } catch (err) {
          if (!rollbackRename(stage, r.abs))
            throw new Error("知识库数据库删除失败且文件回滚失败，请运行 freshness 检查")
          throw err
        }
        try {
          unlinkSync(stage)
        } catch {
          // The index is already gone; leave the non-ingestible staging file for
          // an operator to remove rather than claiming the file was deleted.
          return NextResponse.json(fail("索引已清理，但临时文件删除失败"), {
            status: 500,
          })
        }
        return NextResponse.json(ok({ path: r.rel, purged }))
      } catch (err) {
        return NextResponse.json(fail(safeApiError(err)), { status: 500 })
      }
    })
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
