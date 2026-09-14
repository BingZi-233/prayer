import { createHash } from "node:crypto"
import {
  lstatSync,
  readdirSync,
  realpathSync,
} from "node:fs"
import { relative, resolve, sep } from "node:path"
import type { Repo } from "../core/db/repo.ts"
import {
  isKbIngestibleRelPath,
  MAX_KB_FILE_BYTES,
  readKbFileBoundedNoFollow,
  safeKbAbsAt,
} from "./kb-path.ts"
import { splitCompactedFaq } from "./reflection/compact-chunks.ts"

export type KbFreshnessIssueCode =
  | "FILE_READ_ERROR"
  | "SYMLINK_OUTSIDE_ROOT"
  | "MISSING_INDEX_DOC"
  | "ORPHAN_INDEX_DOC"
  | "ORPHAN_INDEX_VECTOR"
  | "CHUNK_COUNT_MISMATCH"
  | "CHUNK_CONTENT_MISMATCH"
  | "VECTOR_COUNT_MISMATCH"
  | "VECTOR_DIMENSION_MISMATCH"

export interface KbFreshnessIssue {
  code: KbFreshnessIssueCode
  path: string
  detail: string
}

export interface KbFreshnessFile {
  path: string
  sha256: string
  expectedChunks: number
  indexedChunks: number
  indexedVectors: number
}

export interface KbFreshnessReport {
  status: "PASS" | "FAIL"
  root: string
  checkedAt: number
  expectedDimension: number
  actualDimension: number | null
  files: number
  expectedChunks: number
  indexedChunks: number
  indexedVectors: number
  entries: KbFreshnessFile[]
  issues: KbFreshnessIssue[]
}

const DB_ONLY_DOCS = new Set(["human-reflection"])

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function digestChunks(chunks: string[]): string {
  return sha256(Buffer.from(chunks.join("\u0000"), "utf8"))
}

function relativePosix(root: string, path: string): string {
  return relative(root, path).split(sep).join("/")
}

/**
 * 与 scripts/ingest.ts 相同的文件发现规则，但会拒绝越过根目录的符号链接。
 * freshness 是只读检查；遇到可疑条目只报错，不跟随或改写文件。
 */
function readCorpus(rootInput: string): {
  files: { path: string; bytes: Buffer; text: string; chunks: string[] }[]
  issues: KbFreshnessIssue[]
  root: string
} {
  const requestedRoot = resolve(rootInput)
  try {
    if (lstatSync(requestedRoot).isSymbolicLink()) {
      return {
        files: [],
        issues: [
          {
            code: "SYMLINK_OUTSIDE_ROOT",
            path: rootInput,
            detail: "知识库根目录不能是符号链接",
          },
        ],
        root: requestedRoot,
      }
    }
  } catch {
    // 下面的 realpath 分支会把缺失/不可读根目录转换为结构化错误。
  }
  let root: string
  try {
    root = realpathSync(requestedRoot)
  } catch (error) {
    return {
      files: [],
      issues: [
        {
          code: "FILE_READ_ERROR",
          path: rootInput,
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
      root: requestedRoot,
    }
  }
  const issues: KbFreshnessIssue[] = []
  const files: {
    path: string
    bytes: Buffer
    text: string
    chunks: string[]
  }[] = []

  let entries: string[]
  try {
    entries = readdirSync(root, { recursive: true })
      .map((entry) => String(entry).split(sep).join("/"))
      .filter((entry) => isKbIngestibleRelPath(entry))
      .sort()
  } catch (error) {
    issues.push({
      code: "FILE_READ_ERROR",
      path: rootInput,
      detail: error instanceof Error ? error.message : String(error),
    })
    return { files, issues, root }
  }

  for (const rel of entries) {
    const abs = resolve(root, rel)
    try {
      // Keep the read-only gate identical to ingest and the KB API: any
      // symlink component (including one that points back inside the root) is
      // rejected, so a later ingest cannot see a different corpus than this
      // freshness report.
      const safe = safeKbAbsAt(root, rel)
      if (!safe) {
        issues.push({
          code: "SYMLINK_OUTSIDE_ROOT",
          path: rel,
          detail: "路径包含符号链接或不在知识库根目录内",
        })
        continue
      }
      const real = realpathSync(safe)
      if (real !== root && !real.startsWith(`${root}${sep}`)) {
        issues.push({
          code: "SYMLINK_OUTSIDE_ROOT",
          path: rel,
          detail: `realpath ${real} 不在 ${root} 内`,
        })
        continue
      }
      const bounded = readKbFileBoundedNoFollow(safe, MAX_KB_FILE_BYTES)
      if (bounded === null) {
        issues.push({
          code: "FILE_READ_ERROR",
          path: rel,
          detail: "文件无法通过安全、无跟随读取打开",
        })
        continue
      }
      if ("tooLarge" in bounded) {
        issues.push({
          code: "FILE_READ_ERROR",
          path: rel,
          detail: `文件超过 ${MAX_KB_FILE_BYTES} 字节上限`,
        })
        continue
      }
      const text = bounded.content
      const bytes = Buffer.from(text, "utf8")
      files.push({
        path: relativePosix(root, abs),
        bytes,
        text,
        chunks: splitCompactedFaq(text),
      })
    } catch (error) {
      issues.push({
        code: "FILE_READ_ERROR",
        path: rel,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { files, issues, root }
}

/**
 * 只读比较磁盘语料与生产索引。不会调用 embed、写 SQLite 或修改任何文件。
 * exact chunk 比较能发现「文件已改但索引仍是旧内容」，向量计数/维度比较能发现
 * 半成品入库或使用了错误 embedding 模型的索引。
 */
export function checkKbFreshness(
  repo: Pick<
    Repo,
    | "kbDocStats"
    | "kbDocVectorStats"
    | "kbOrphanVectorCount"
    | "kbChunksByDoc"
    | "kbVectorDimension"
  >,
  rootInput = "docs/kb",
  expectedDimension = 512,
  now = Date.now
): KbFreshnessReport {
  if (!Number.isInteger(expectedDimension) || expectedDimension <= 0) {
    throw new RangeError("expectedDimension must be a positive integer")
  }

  const { files, issues, root } = readCorpus(rootInput)
  const diskDocs = new Map(files.map((file) => [file.path, file]))
  const stats = repo.kbDocStats()
  const vectorStats = new Map(
    repo.kbDocVectorStats().map((row) => [row.doc, row])
  )
  const orphanVectors = repo.kbOrphanVectorCount()
  const indexedDocs = new Set(stats.map((row) => row.doc))
  const totalIndexedVectors =
    [...vectorStats.values()].reduce((sum, row) => sum + row.vecs, 0) +
    orphanVectors
  if (orphanVectors > 0) {
    issues.push({
      code: "ORPHAN_INDEX_VECTOR",
      path: "kb_vec",
      detail: `索引存在 ${orphanVectors} 个没有对应 kb_chunks 的向量`,
    })
  }
  const entries: KbFreshnessFile[] = []

  for (const file of files) {
    const row = stats.find((item) => item.doc === file.path)
    const vectorRow = vectorStats.get(file.path)
    const indexedChunks = row?.chunks ?? 0
    const indexedVectors = vectorRow?.vecs ?? 0
    entries.push({
      path: file.path,
      sha256: sha256(file.bytes),
      expectedChunks: file.chunks.length,
      indexedChunks,
      indexedVectors,
    })
    if (!row) {
      issues.push({
        code: "MISSING_INDEX_DOC",
        path: file.path,
        detail: "磁盘文件没有对应的 kb_chunks 文档",
      })
      continue
    }
    if (indexedChunks !== file.chunks.length) {
      issues.push({
        code: "CHUNK_COUNT_MISMATCH",
        path: file.path,
        detail: `磁盘 ${file.chunks.length} 块，索引 ${indexedChunks} 块`,
      })
    }
    const indexed = repo.kbChunksByDoc(file.path).map((item) => item.content)
    if (digestChunks(indexed) !== digestChunks(file.chunks)) {
      issues.push({
        code: "CHUNK_CONTENT_MISMATCH",
        path: file.path,
        detail: `磁盘块摘要 ${digestChunks(file.chunks)}，索引块摘要 ${digestChunks(indexed)}`,
      })
    }
    if (indexedVectors !== indexedChunks) {
      issues.push({
        code: "VECTOR_COUNT_MISMATCH",
        path: file.path,
        detail: `索引 ${indexedChunks} 块但只有 ${indexedVectors} 个向量`,
      })
    }
  }

  for (const doc of indexedDocs) {
    if (DB_ONLY_DOCS.has(doc) || diskDocs.has(doc)) continue
    issues.push({
      code: "ORPHAN_INDEX_DOC",
      path: doc,
      detail: "索引存在但磁盘没有对应文件",
    })
  }

  const actualDimension = repo.kbVectorDimension()
  if (actualDimension === null && totalIndexedVectors > 0) {
    issues.push({
      code: "VECTOR_DIMENSION_MISMATCH",
      path: "kb_vec",
      detail: "索引存在向量但无法解析其 embedding 维度",
    })
  } else if (
    actualDimension !== null &&
    actualDimension !== expectedDimension
  ) {
    issues.push({
      code: "VECTOR_DIMENSION_MISMATCH",
      path: "kb_vec",
      detail: `索引维度 ${actualDimension}，预期 ${expectedDimension}`,
    })
  }

  const expectedChunks = files.reduce(
    (sum, file) => sum + file.chunks.length,
    0
  )
  const indexedChunks = entries.reduce(
    (sum, file) => sum + file.indexedChunks,
    0
  )
  const indexedVectors = entries.reduce(
    (sum, file) => sum + file.indexedVectors,
    0
  )
  return {
    status: issues.length === 0 ? "PASS" : "FAIL",
    root,
    checkedAt: now(),
    expectedDimension,
    actualDimension,
    files: files.length,
    expectedChunks,
    indexedChunks,
    indexedVectors,
    entries,
    issues,
  }
}
