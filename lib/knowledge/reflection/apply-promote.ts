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
import { MAX_MERGE_CHUNKS, unitShapeIssue } from "./promote-compose"
import {
  formatDate,
  promoteManifest,
  promoteManifestRel,
  promoteSnapshotRel,
  sha256Hex,
} from "./promote-manifest"

export type PromoteResult =
  | { ok: true; file: string; content: string; already?: boolean }
  | { ok: false; reason: string }

/** 第二阶段成文后的升格单元,由 promote-compose 的 composePromotion 产出。 */
export interface PromoteUnit {
  /** 目标文档相对 docs/kb 的 posix 路径,必须是 retrieval/ 下的 canonical 文档 */
  doc: string
  /** merge=读旧正文后追加;new=新建文件 */
  kind: "merge" | "new"
  /** 完整单元文本:标题行紧跟正文,无空行,不超过 500 字符 */
  content: string
  sourceStatus: string
  volatility: string
}

export interface ApplyPromoteOpts {
  repo: Repo
  chunkId: number
  unit: PromoteUnit
  embed: (text: string) => Promise<Float32Array>
  /** 知识库根目录(含 docs/kb 的上一级 cwd)。缺省 process.cwd() */
  cwd?: string
  now?: () => number
  /** 可注入写盘,测试用 */
  writeFileFn?: (abs: string, body: string) => Promise<void>
  mkdirFn?: (dir: string) => Promise<void>
  /** 台账/快照写盘,测试可注入;缺省真实写盘 */
  writeMetaFn?: (abs: string, body: string) => Promise<void>
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
 * 1. 先在 docs/kb/_meta 落 pre-edit 快照与 manifest(含两侧 SHA-256)
 * 2. 写目标 canonical 文档(merge 时读旧正文后追加)
 * 3. 重新分块、embed 写入 kb_chunks(doc=相对路径),同事务物理删除原反思 chunk
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
  const { repo, chunkId, unit, embed } = opts
  // 单条取行(替代全量 reflectionEntries 拉取后再 find)
  const entry = repo.reflectionEntryDetail(chunkId)
  if (!entry) return { ok: false, reason: "条目不存在" }
  if (entry.status === "rejected")
    return { ok: false, reason: "已驳回,不可升格" }
  if (entry.status === "promoted") {
    return {
      ok: true,
      // 与 promoteEntry 的同名分支保持一致:回 unit.doc 只是把调用方声称的目标
      // 原样回传,而那次升格当初真实落到哪个文档未必是它。宁可留空也不回一个
      // 未必为真的路径。生产不可达(升格即 deleteKbChunk 物理删行),此处纯防御。
      file: "",
      content: entry.content,
      already: true,
    }
  }

  const shapeIssue = unitShapeIssue(unit.content)
  if (shapeIssue) return { ok: false, reason: shapeIssue }

  const rel = unit.doc
  const cwd = opts.cwd ?? process.cwd()
  const kbRoot = join(cwd, "docs/kb")
  const now = opts.now ?? (() => Date.now())
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
  const writeMetaFn =
    opts.writeMetaFn ?? ((p: string, b: string) => writeFile(p, b, "utf8"))
  // 台账路径的 symlink 守卫只在真写盘时做:测试注入的假 fs 没有真实目录。
  // 判据与上面的 needsPathGuard 同构(任一操作走真盘就要守),不写成"两者都真":
  // 只注入 mkdirFn 而 writeMetaFn 留真盘时,后者仍会往真实 _meta 写,守卫不能关。
  const metaGuarded = !opts.mkdirFn || !opts.writeMetaFn

  // 先定正文,再动盘:merge 必须读到旧正文才能拼出整份新文档,
  // 读不到就直接失败而不静默新建——否则会把 canonical 文档换成只剩这条的新文件。
  let previous: string | undefined
  let previousChunks: string[] = []
  if (unit.kind === "merge") {
    previous = readPreviousFile(abs)
    if (previous === undefined) return { ok: false, reason: "目标文档不存在" }
    previousChunks = splitCompactedFaq(previous)
    // 尺寸闸门要让开"去重命中"这一种情况才算得对:崩溃残局可能恰好比上限多一段
    // (P0 正好 MAX_MERGE_CHUNKS 段时首次 merge 合法 → 残局 MAX+1 段)。
    // 若尺寸闸门先行,重试会一直撞这里、永远走不到下面的去重,于是文件与索引
    // 永久分叉、条目永远 approved,每轮白烧两次 LLM 调用。
    // 去重命中时"追加"其实是 no-op 重提交,尺寸上限对它不适用。
    if (
      previousChunks.length > MAX_MERGE_CHUNKS &&
      !previousChunks.includes(unit.content.trim())
    )
      return { ok: false, reason: "目标文档过大,拒绝合并" }
  } else if (fileExists(abs)) {
    // resolveTarget 已把"已存在"转成 merge,走到这里说明竞态新建了同名文件。
    return { ok: false, reason: "目标文档已存在" }
  }

  // 幂等的追加。崩溃可能落在 rename 成功之后、下面的 DB 事务提交之前:
  // 此时磁盘已是 P0+单元、台账是 committed 且哈希与磁盘一致,但索引还是旧的 P0、
  // 反思条目仍 approved —— 下一轮会自动重试。若直接再追加一次,文档与向量都会
  // 出现双份(旧实现是全文覆盖,天然幂等;改成追加后才引入这个放大后果)。
  // 按段落判重即可收敛:重试读到的是同一份 P0+单元,于是重算出同一个 body,
  // 原样重写一遍,再把 DB 事务补做掉。
  const unitAlreadyPresent =
    previous !== undefined && previousChunks.includes(unit.content.trim())
  const body =
    previous === undefined
      ? `${unit.content}\n`
      : unitAlreadyPresent
        ? previous
        : `${previous.trimEnd()}\n\n${unit.content}\n`
  if (Buffer.byteLength(body, "utf8") > MAX_KB_FILE_BYTES)
    return { ok: false, reason: "知识库文件过大" }

  // Promotion and full ingest must produce the same index shape. The unit's
  // heading and body are separate paragraphs, so the document is re-split and
  // re-embedded as a whole instead of copying the unit as one vector.
  const embeddedChunks: { content: string; embedding: Float32Array }[] = []
  for (const content of splitCompactedFaq(body)) {
    embeddedChunks.push({ content, embedding: await embed(content) })
  }

  await mkdirFn(dirname(abs))
  if (needsPathGuard && !safeKbAbsAt(kbRoot, rel))
    return { ok: false, reason: "知识库路径非法" }
  if (!(await prepareMetaDir(kbRoot, mkdirFn, metaGuarded)))
    return { ok: false, reason: "台账目录非法" }

  const date = formatDate(now())
  const snapshotRel = promoteSnapshotRel(date, chunkId)
  const manifestRel = promoteManifestRel(date, chunkId)
  const manifestInput = {
    chunkId,
    variant: "promotion" as const,
    decision: unit.kind,
    target: rel,
    originalPath: previous === undefined ? null : rel,
    retiredPath: null,
    relocationReason: null,
    preEditSnapshot: previous === undefined ? null : snapshotRel,
    preSha256: previous === undefined ? null : sha256Hex(previous),
    postSha256: sha256Hex(body),
    sourceStatus: unit.sourceStatus,
    volatility: unit.volatility,
    chunks: embeddedChunks.map((c) => c.content),
    embeddedChunks: embeddedChunks.length,
    dimension: repo.kbVectorDimension(),
    rolledBack: false,
    date,
  }

  // 台账先于活跃语料。正文与两侧 SHA-256 都已在内存确定,所以这一步不需要
  // 先写文件再回填摘要;台账写不出去就整条放弃,而不是留下无记录的语料。
  if (previous !== undefined)
    await writeMetaFn(join(kbRoot, snapshotRel), previous)
  await writeMetaFn(join(kbRoot, manifestRel), promoteManifest(manifestInput))

  // Tests may inject both filesystem operations. Keep that seam simple; the
  // production path below uses a same-directory temp file and atomic rename.
  if (!defaultFs) {
    try {
      await writeFileFn(abs, body)
      writeKbTransaction(repo, chunkId, rel, embeddedChunks)
    } catch (err) {
      // 台账先于正文落盘,所以正文这一步(含注入的写盘)失败时,台账已经停在
      // committed 且 postSha256 指向从未落盘的内容。必须改写成 rolled_back,
      // 否则留下的是一条说谎的"成功"记录。
      await writeMetaFn(
        join(kbRoot, manifestRel),
        promoteManifest({ ...manifestInput, rolledBack: true })
      )
      throw err
    }
    return { ok: true, file: rel, content: entry.content }
  }

  // `abs` has already passed the root/symlink guard. Derive a fixed-name
  // sibling from it instead of sending the internal `.tmp` suffix through
  // safeKbAbsAt (which intentionally accepts only ingestible document types).
  const tempAbs = join(
    dirname(abs),
    `.promotion-${chunkId}.${randomUUID()}.tmp`
  )

  // Treat the random temp path as live before opening it. If a write fails
  // after creating a partial file, the finally block still removes it.
  let tempLive = true
  try {
    if (!safeKbAbsAt(kbRoot, rel)) throw new Error("知识库路径非法")
    await writeFile(tempAbs, body, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })

    if (!safeKbAbsAt(kbRoot, rel)) throw new Error("知识库路径非法")
    await rename(tempAbs, abs)
    tempLive = false

    writeKbTransaction(repo, chunkId, rel, embeddedChunks)
  } catch (err) {
    // 台账先于正文落盘,所以这里任何一步失败(临时文件写、rename、safeKbAbsAt
    // 复检、DB 事务)之后,台账都可能停在 committed——不重写就留下一条指向
    // 未落盘内容的"成功"记录。
    // 不拆内外两层:DB 失败也在本 catch 内,拆开会让 DB 路径重复 restoreFile
    // 与重复写台账(幂等,但纯属死重)。
    // restoreFile 对所有分支都安全:rename 没发生时 abs 要么不存在(new)、
    // 要么还是 previous 原样(merge),两种情况都不破坏既有内容。
    try {
      await restoreFile(abs, previous, kbRoot, rel)
    } finally {
      await writeMetaFn(
        join(kbRoot, manifestRel),
        promoteManifest({ ...manifestInput, rolledBack: true })
      )
    }
    throw err
  } finally {
    if (tempLive)
      await unlink(tempAbs).catch((err) => {
        if (!isNotFound(err)) throw err
      })
  }

  return { ok: true, file: rel, content: entry.content }
}

function fileExists(abs: string): boolean {
  try {
    return lstatSync(abs).isFile()
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

/**
 * `_meta/*.md.disabled` 不属于可入库文档,不能用 safeKbAbsAt(它只认 .md/.txt)。
 * 路径全部由程序生成、不含模型输入,所以这里只守住「_meta 本身不是符号链接」。
 * guarded=false(测试注入假 fs)时跳过 lstat,只调 mkdirFn。
 */
async function prepareMetaDir(
  kbRoot: string,
  mkdirFn: (dir: string) => Promise<void>,
  guarded: boolean
): Promise<boolean> {
  const metaDir = join(kbRoot, "_meta")
  if (guarded) {
    try {
      if (lstatSync(metaDir).isSymbolicLink()) return false
    } catch (error) {
      if (!isNotFound(error)) return false
    }
  }
  await mkdirFn(metaDir)
  if (!guarded) return true
  try {
    return !lstatSync(metaDir).isSymbolicLink()
  } catch {
    return false
  }
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
  rel: string
): Promise<void> {
  if (previous === undefined) {
    if (!safeKbAbsAt(kbRoot, rel)) throw new Error("知识库路径非法")
    await unlink(abs).catch((err) => {
      if (!isNotFound(err)) throw err
    })
    return
  }

  // The destination was validated before the rename; this is a generated
  // sibling name, not user-controlled path input.
  if (!safeKbAbsAt(kbRoot, rel)) throw new Error("知识库路径非法")
  const restoreAbs = join(
    dirname(abs),
    `.promotion-restore-${randomUUID()}.tmp`
  )
  try {
    await writeFile(restoreAbs, previous, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    await rename(restoreAbs, abs)
  } finally {
    await unlink(restoreAbs).catch((err) => {
      if (!isNotFound(err)) throw err
    })
  }
}
