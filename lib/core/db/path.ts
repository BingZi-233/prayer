import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Keep SQLite URI forms intact while resolving ordinary paths from a base dir. */
export function canonicalDbPath(
  path: string,
  baseDir = process.cwd()
): string {
  return path.startsWith(":") || path.startsWith("file:")
    ? path
    : resolve(baseDir, path)
}

/**
 * Return the filename that better-sqlite3 should receive.
 *
 * better-sqlite3 is built with SQLITE_USE_URI=0 in this project, so passing a
 * `file:` URI straight to its constructor does not enable SQLite URI parsing
 * (and commonly fails with "unable to open database file").  We support the
 * unambiguous local-file form while refusing URI query options rather than
 * silently changing their semantics.
 */
export function databaseOpenPath(
  path: string,
  baseDir = process.cwd()
): string {
  if (path.startsWith(":")) return path
  if (!path.startsWith("file:")) return resolve(baseDir, path)

  const localPath = parseLocalFileUri(path, { rejectOptions: true })
  if (localPath) return localPath
  throw new Error(
    "DB_PATH 的 file: URI 必须是本机绝对文件 URI，且不能包含 query 或 fragment"
  )
}

/**
 * Convert a database path to a local filesystem path when that is safe to
 * inspect (for example, for size and permission audits). SQLite URI options
 * are preserved by canonicalDbPath, but `:memory:` and non-local/relative
 * file URIs do not identify a regular path we can safely stat.
 */
export function filesystemDbPath(
  path: string,
  baseDir = process.cwd()
): string | null {
  if (path.startsWith(":")) return null
  if (!path.startsWith("file:")) return resolve(baseDir, path)

  return parseLocalFileUri(path)
}

function parseLocalFileUri(
  path: string,
  options: { rejectOptions?: boolean } = {}
): string | null {
  // Only accept absolute local file URLs. `file:./relative` is interpreted
  // differently by URL parsing and must not be silently mapped elsewhere.
  const raw = path.slice("file:".length)
  if (!raw.startsWith("/") && !raw.startsWith("//")) return null
  try {
    const url = new URL(path)
    if (
      url.protocol !== "file:" ||
      (url.hostname && url.hostname !== "localhost")
    )
      return null
    if (options.rejectOptions && (url.search || url.hash)) return null
    return fileURLToPath(url)
  } catch {
    return null
  }
}
