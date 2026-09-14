import { randomUUID } from "node:crypto"
import { lstatSync } from "node:fs"
import { mkdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Repo } from "../../core/db/repo"
import {
  MAX_KB_FILE_BYTES,
  readKbFileBoundedNoFollow,
  safeKbAbsAt,
} from "../kb-path"
import { withKbMutationLock } from "../mutation-lock"
import { splitCompactedFaq } from "./compact-chunks"

/** 升格后正式文档相对路径(相对 docs/kb) */
export function promotedDocRel(chunkId: number): string {
  return `promoted/reflection-${chunkId}.md`
}

/** 升格 Markdown 正文(与历史手动升格格式一致) */
export function promotedMarkdown(chunkId: number, content: string): string {
  return `# 升格反思 #${chunkId}\n\n${content.trim()}\n`
}

export type PromoteResult =
  | { ok: true; file: string; content: string; already?: boolean }
  | { ok: false; reason: string }

export interface ApplyPromoteOpts {
  repo: Repo
  chunkId: number
  embed: (text: string) => Promise<Float32Array>
  /** 知识库根目录(含 docs/kb 的上一级 cwd)。缺省 process.cwd() */
  cwd?: string
  /** 可注入写盘,测试用 */
  writeFileFn?: (abs: string, body: string) => Promise<void>
  mkdirFn?: (dir: string) => Promise<void>
}

const promotionGlobal = globalThis as unknown as {
  __prayerPromotionLocks?: Map<string, Promise<void>>
}
const promotionLocks =
  promotionGlobal.__prayerPromotionLocks ??
  (promotionGlobal.__prayerPromotionLocks = new Map())

/**
 * 手动 PATCH 与定时升格会共用同一进程。按目标文件串行可避免失败的一方
 * 在回滚文件时覆盖另一方刚提交的成功结果；部署仍要求 PM2 单实例。
 */
function withPromotionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = promotionLocks.get(key) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(fn)
  const tail = operation.then(
    () => undefined,
    () => undefined
  )
  promotionLocks.set(key, tail)
  return operation.finally(() => {
    if (promotionLocks.get(key) === tail) promotionLocks.delete(key)
  })
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

/**
 * Keep an unreadable existing target from being mistaken for an absent one.
 * A null result from the bounded no-follow reader covers both cases by design, but
 * promotion must not overwrite a file it could not snapshot for rollback.
 */
function readPreviousFile(abs: string): string | undefined {
  let present = false
  try {
    lstatSync(abs)
    present = true
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
  const result = readKbFileBoundedNoFollow(abs, MAX_KB_FILE_BYTES)
  if (result === null) {
    if (present) throw new Error("无法读取现有正式文件")
    return undefined
  }
  if ("tooLarge" in result) throw new Error("现有正式文件过大")
  return result.content
}

/**
 * 将一条 human-reflection 升格为正式文档:
 * 1. 写 docs/kb/promoted/reflection-{id}.md
 * 2. 立即 embed 写入 kb_chunks(doc=相对路径),Agent 检索可命中
 * 3. 物理删除原反思 chunk,避免列表 / 检索残留
 *
 * 幂等:已 promoted 则返回 already,不重写、不再删(原 chunk 早已不在)。
 */
export async function applyPromote(
  opts: ApplyPromoteOpts
): Promise<PromoteResult> {
  // The lock key only distinguishes callers in this process; path canonicality
  // is still enforced by safeKbAbsAt below, so avoid feeding a dynamic path
  // expression to Next's filesystem tracer here.
  const key = `${opts.cwd ?? process.cwd()}:${opts.chunkId}`
  return withPromotionLock(key, () =>
    withKbMutationLock(() => applyPromoteUnlocked(opts))
  )
}

async function applyPromoteUnlocked(
  opts: ApplyPromoteOpts
): Promise<PromoteResult> {
  const { repo, chunkId, embed } = opts
  // 单条取行(替代全量 reflectionEntries 拉取后再 find)
  const entry = repo.reflectionEntryDetail(chunkId)
  if (!entry) return { ok: false, reason: "条目不存在" }
  if (entry.status === "rejected")
    return { ok: false, reason: "已驳回,不可升格" }
  if (entry.status === "promoted") {
    return {
      ok: true,
      file: promotedDocRel(chunkId),
      content: entry.content,
      already: true,
    }
  }

  const rel = promotedDocRel(chunkId)
  const body = promotedMarkdown(chunkId, entry.content)
  if (Buffer.byteLength(body, "utf8") > MAX_KB_FILE_BYTES)
    return { ok: false, reason: "知识库文件过大" }
  const cwd = opts.cwd ?? process.cwd()
  const kbRoot = join(cwd, "docs/kb")
  const defaultFs = !opts.writeFileFn && !opts.mkdirFn
  // If either operation uses the real filesystem, validate the path. A single
  // injected writer must not silently disable the guard while the other
  // operation still touches disk.
  const needsPathGuard = !opts.writeFileFn || !opts.mkdirFn
  const guardedAbs = safeKbAbsAt(kbRoot, rel)
  if (needsPathGuard && !guardedAbs)
    return { ok: false, reason: "知识库路径非法" }
  const abs = guardedAbs ?? join(cwd, "docs/kb", rel)
  const mkdirFn =
    opts.mkdirFn ??
    ((d: string) => mkdir(d, { recursive: true }).then(() => undefined))
  const writeFileFn =
    opts.writeFileFn ?? ((p: string, b: string) => writeFile(p, b, "utf8"))

  // Promotion and full ingest must produce the same index shape.  The
  // Markdown heading and body are separate paragraphs, so indexing the whole
  // document as one vector immediately makes the freshness gate fail.
  const embeddedChunks: { content: string; embedding: Float32Array }[] = []
  for (const content of splitCompactedFaq(body)) {
    embeddedChunks.push({ content, embedding: await embed(content) })
  }

  await mkdirFn(dirname(abs))
  if (needsPathGuard && !safeKbAbsAt(kbRoot, rel))
    return { ok: false, reason: "知识库路径非法" }

  // Tests may inject both filesystem operations. Keep that seam simple; the
  // production path below uses a same-directory temp file and atomic rename.
  if (!defaultFs) {
    await writeFileFn(abs, body)
    writeKbTransaction(repo, chunkId, rel, embeddedChunks)
    return { ok: true, file: rel, content: entry.content }
  }

  // `abs` has already passed the root/symlink guard.  Derive a fixed-name
  // sibling from it instead of sending the internal `.tmp` suffix through
  // safeKbAbsAt (which intentionally accepts only ingestible document types).
  const tempAbs = join(
    dirname(abs),
    `.reflection-${chunkId}.${randomUUID()}.tmp`
  )

  // Treat the random temp path as live before opening it. If a write fails
  // after creating a partial file, the finally block still removes it.
  let tempLive = true
  let previous: string | undefined
  try {
    if (!safeKbAbsAt(kbRoot, rel)) throw new Error("知识库路径非法")
    await writeFile(tempAbs, body, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })

    if (!safeKbAbsAt(kbRoot, rel)) throw new Error("知识库路径非法")
    // Open through O_NOFOLLOW so a final-component symlink swap cannot expose
    // an outside file while we snapshot the previous document.
    previous = readPreviousFile(abs)

    if (!safeKbAbsAt(kbRoot, rel)) throw new Error("知识库路径非法")
    await rename(tempAbs, abs)
    tempLive = false

    try {
      writeKbTransaction(repo, chunkId, rel, embeddedChunks)
    } catch (err) {
      await restoreFile(abs, previous, kbRoot, chunkId)
      throw err
    }
  } finally {
    if (tempLive)
      await unlink(tempAbs).catch((err) => {
        if (!isNotFound(err)) throw err
      })
  }

  return { ok: true, file: rel, content: entry.content }
}

function writeKbTransaction(
  repo: Repo,
  chunkId: number,
  rel: string,
  chunks: readonly { content: string; embedding: Float32Array }[]
): void {
  // 三个 DB 步骤同一事务:中途失败整体回滚,原反思条目保留。
  repo.transaction(() => {
    repo.deleteKbDoc(rel)
    for (const chunk of chunks)
      repo.insertKbEntry(rel, chunk.content, rel, chunk.embedding)
    repo.deleteKbChunk(chunkId)
  })
}

async function restoreFile(
  abs: string,
  previous: string | undefined,
  kbRoot: string,
  chunkId: number
): Promise<void> {
  if (previous === undefined) {
    if (!safeKbAbsAt(kbRoot, `promoted/reflection-${chunkId}.md`))
      throw new Error("知识库路径非法")
    await unlink(abs).catch((err) => {
      if (!isNotFound(err)) throw err
    })
    return
  }

  // The destination was validated before the rename; this is a generated
  // sibling name, not user-controlled path input.
  if (!safeKbAbsAt(kbRoot, `promoted/reflection-${chunkId}.md`))
    throw new Error("知识库路径非法")
  const restoreAbs = join(
    dirname(abs),
    `.reflection-${chunkId}.restore-${randomUUID()}.tmp`
  )
  try {
    await writeFile(restoreAbs, previous, { encoding: "utf8", flag: "wx", mode: 0o600 })
    await rename(restoreAbs, abs)
  } finally {
    await unlink(restoreAbs).catch((err) => {
      if (!isNotFound(err)) throw err
    })
  }
}
