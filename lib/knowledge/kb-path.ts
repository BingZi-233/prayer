import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join, relative, resolve, sep } from "node:path"

export const KB_DIR = "docs/kb"
export const KB_ROOT = resolve(KB_DIR)
/** API 读取单个知识文档时的上限；写入端使用同一上限。 */
export const MAX_KB_FILE_BYTES = 512_000

/** 相对路径是否合法(无穿越、仅 .md/.txt、posix 分隔) */
export function isKbRelPath(rel: string): boolean {
  if (!rel || typeof rel !== "string") return false
  if (rel.includes("\0") || rel.includes("\\")) return false
  if (rel.startsWith("/") || rel.startsWith("./") || rel.startsWith("../"))
    return false
  const parts = rel.split("/")
  if (parts.some((p) => !p || p === "." || p === "..")) return false
  return rel.endsWith(".md") || rel.endsWith(".txt")
}

/** Production ingest only sees active KB content; archived trees are history. */
export function isKbIngestibleRelPath(rel: string): boolean {
  return isKbRelPath(rel) && !rel.split("/").includes("_archive")
}

/** catch-all 段 → 相对 posix 路径 */
export function relFromParts(parts: string[]): string {
  try {
    return parts.map((p) => decodeURIComponent(p)).join("/")
  } catch {
    return ""
  }
}

/** 相对路径 → 绝对路径;非法返回 null */
export function safeKbAbs(rel: string): string | null {
  return safeKbAbsAt(KB_ROOT, rel)
}

/**
 * Read a previously validated KB file through an fd.  O_NOFOLLOW closes the
 * final-component symlink swap between safeKbAbs() and the actual read.
 * null means the path disappeared, became a link, or is not a regular file.
 */
export function readKbFileNoFollow(path: string): string | null {
  const result = readKbFileBoundedNoFollow(path, MAX_KB_FILE_BYTES)
  return result && "content" in result ? result.content : null
}

export type BoundedKbRead = { content: string } | { tooLarge: true }

/**
 * Read a KB file without allocating based on an attacker-controlled size.
 * The initial fstat is only an optimization; the bounded read also handles a
 * concurrent writer growing the file after the check.
 */
export function readKbFileBoundedNoFollow(
  path: string,
  maxBytes = MAX_KB_FILE_BYTES
): BoundedKbRead | null {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > MAX_KB_FILE_BYTES
  )
    return null
  let fd: number | undefined
  try {
    fd = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    )
    const stat = fstatSync(fd)
    if (!stat.isFile()) return null
    if (stat.size > maxBytes) return { tooLarge: true }

    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let total = 0
    while (total < buffer.length) {
      const read = readSync(fd, buffer, total, buffer.length - total, null)
      if (read === 0) break
      total += read
    }
    if (total > maxBytes) return { tooLarge: true }
    return { content: buffer.subarray(0, total).toString("utf8") }
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Update a previously validated KB file through a same-directory temporary
 * file and an atomic rename. The old inode is never truncated in place, so a
 * concurrent reader sees either the old document or the complete new one.
 * O_NOFOLLOW and the inode re-check retain the final-component symlink guard.
 * false means the path was unsafe, changed, or the write could not complete.
 */
export function writeKbFileNoFollow(path: string, content: string): boolean {
  if (Buffer.byteLength(content, "utf8") > MAX_KB_FILE_BYTES) return false
  let targetFd: number | undefined
  let tempFd: number | undefined
  let tempPath: string | undefined
  let committed = false
  try {
    targetFd = openSync(
      path,
      constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    )
    const targetStat = fstatSync(targetFd)
    if (!targetStat.isFile()) return false

    tempPath = join(dirname(path), `.prayer-kb-${randomUUID()}.tmp`)
    tempFd = openSync(
      /* turbopackIgnore: true */ tempPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
      0o600
    )
    writeFileSync(tempFd, content, "utf8")
    fsyncSync(tempFd)
    closeSync(tempFd)
    tempFd = undefined

    // Do not replace a target another writer swapped in while we were
    // preparing the new file. Opening with O_NOFOLLOW also rejects a final
    // symlink introduced during that window.
    const checkFd = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    )
    try {
      const checkStat = fstatSync(checkFd)
      if (
        !checkStat.isFile() ||
        checkStat.dev !== targetStat.dev ||
        checkStat.ino !== targetStat.ino
      )
        return false
    } finally {
      closeSync(checkFd)
    }

    closeSync(targetFd)
    targetFd = undefined
    renameSync(tempPath, path)
    committed = true
    return true
  } catch {
    return false
  } finally {
    if (targetFd !== undefined) closeSync(targetFd)
    if (tempFd !== undefined) closeSync(tempFd)
    if (tempPath && !committed) {
      try {
        lstatSync(tempPath)
        // The temporary name is deliberately not an ingestible extension.
        // Remove it only after confirming it is the file we created.
        unlinkSync(tempPath)
      } catch {
        // A failed write/rename may already have removed the temp file.
      }
    }
  }
}

/** Create a new KB file atomically without following/replacing a final link. */
export function createKbFileNoFollow(path: string, content: string): boolean {
  if (Buffer.byteLength(content, "utf8") > MAX_KB_FILE_BYTES) return false
  let fd: number | undefined
  let tempPath: string | undefined
  let committed = false
  try {
    tempPath = join(dirname(path), `.prayer-kb-${randomUUID()}.tmp`)
    fd = openSync(
      /* turbopackIgnore: true */ tempPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
      0o600
    )
    if (!fstatSync(fd).isFile()) return false
    writeFileSync(fd, content, "utf8")
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined

    // link(2) creates the destination atomically and fails with EEXIST rather
    // than replacing it.  This closes the check/rename race while retaining
    // the no-follow boundary for a pre-existing final symlink.
    linkSync(/* turbopackIgnore: true */ tempPath, path)
    // The destination is committed once link(2) succeeds. A cleanup failure
    // must not make the caller believe creation failed and leave an orphaned
    // but valid destination behind.
    committed = true
    try {
      unlinkSync(/* turbopackIgnore: true */ tempPath)
    } catch {
      // The hidden .tmp hard link is non-ingestible; an operator can remove it
      // later without affecting the committed destination.
    }
    return true
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (tempPath && !committed) {
      try {
        lstatSync(tempPath)
        unlinkSync(tempPath)
      } catch {
        // Best-effort cleanup; a stale .tmp is never part of the ingest glob.
      }
    }
  }
}

/** 在指定 KB 根下执行同一 realpath/symlink 校验(工具可注入 cwd)。 */
export function safeKbAbsAt(root: string, rel: string): string | null {
  if (!isKbRelPath(rel)) return null
  const rootAbs = resolve(root)
  const p = resolve(rootAbs, rel)
  if (p !== rootAbs && !p.startsWith(rootAbs + sep)) return null
  try {
    if (lstatSync(rootAbs).isSymbolicLink()) return null
  } catch {
    return null
  }

  // Lexical containment is not enough: a directory or file below docs/kb may
  // be a symlink to secrets elsewhere. Reject symlink components and verify
  // the real path of the nearest existing component before any file operation.
  const rootReal = realPath(rootAbs)
  if (!rootReal || hasSymlinkComponent(rootAbs, p)) return null
  const existing = nearestExisting(p)
  if (!existing) return null
  const existingReal = realPath(existing)
  if (!existingReal || !isWithin(rootReal, existingReal)) return null
  if (lstatIsPresent(p)) {
    const targetReal = realPath(p)
    if (!targetReal || !isWithin(rootReal, targetReal)) return null
    try {
      if (!lstatSync(p).isFile()) return null
    } catch {
      return null
    }
  }
  return p
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep)
}

function realPath(path: string): string | null {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

function lstatIsPresent(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function nearestExisting(path: string): string | null {
  let current = path
  while (true) {
    if (lstatIsPresent(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function hasSymlinkComponent(root: string, path: string): boolean {
  const rel = relative(root, path)
  let current = root
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      if (lstatSync(current).isSymbolicLink()) return true
    } catch {
      // A not-yet-created suffix cannot be a symlink; its existing parent was
      // already checked by nearestExisting/realpath above.
      break
    }
  }
  return false
}
