import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs"
import { resolve } from "node:path"
import { filesystemDbPath } from "../lib/core/db/path.ts"

export const RESTRICTED_FILE_MODE = 0o600

export type PermissionTarget = Readonly<{
  path: string
  /** Optional files (for example a not-yet-created WAL) do not fail the gate. */
  required?: boolean
}>

export type PermissionFinding = Readonly<{
  path: string
  required: boolean
  status: "ok" | "missing" | "symlink" | "not-file" | "too-open" | "error"
  mode?: number
  detail?: string
}>

function hasUnsafeSymlink(path: string): boolean {
  const lexical = resolve(path)
  try {
    const canonical = realpathSync.native(lexical)
    if (canonical === lexical) return false
    // macOS commonly aliases /tmp and /var to /private/*; allow only those
    // fixed OS mappings, never an operator-selected link in the middle.
    if (process.platform === "darwin") {
      const normalized = lexical.startsWith("/tmp/")
        ? `/private${lexical}`
        : lexical.startsWith("/var/")
          ? `/private${lexical}`
          : lexical
      if (canonical === normalized) return false
    }
    return true
  } catch {
    // Missing paths are classified by lstat below; no chmod can occur.
    return false
  }
}

/**
 * Build the small, explicit set of files that can contain credentials or
 * conversation data. This intentionally does not recurse through data/.
 */
export function defaultPermissionTargets(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): PermissionTarget[] {
  const targets: PermissionTarget[] = [{ path: resolve(cwd, ".env") }]
  const dbPath = env.DB_PATH ?? "./data/agent.db"
  const db = filesystemDbPath(dbPath, cwd)
  if (db) {
    targets.push(
      { path: db, required: true },
      { path: `${db}-wal` },
      { path: `${db}-shm` }
    )
  }
  const configDir = resolve(
    cwd,
    env.CLAUDE_CONFIG_DIR ?? "./data/claude-config"
  )
  // Claude keeps credentials/session state in both the live settings file and
  // common local copies; include the copies explicitly without recursively
  // traversing the large projects/transcript tree.
  for (const name of ["settings.json", "settings copy.json", ".claude.json"])
    targets.push({ path: resolve(configDir, name) })
  targets.push({ path: resolve(configDir, "mcp-needs-auth-cache.json") })
  for (const path of (env.PRAYER_BACKUP_PATHS ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)) {
    targets.push({ path: resolve(cwd, path) })
  }
  return dedupeTargets(targets)
}

function dedupeTargets(targets: PermissionTarget[]): PermissionTarget[] {
  const seen = new Map<string, PermissionTarget>()
  for (const target of targets) {
    const path = resolve(target.path)
    const prior = seen.get(path)
    seen.set(path, {
      path,
      required: Boolean(target.required || prior?.required),
    })
  }
  return [...seen.values()]
}

export function auditPermissions(
  targets: readonly PermissionTarget[]
): PermissionFinding[] {
  return targets.map((target) => {
    const required = Boolean(target.required)
    try {
      const stat = lstatSync(target.path)
      const mode = stat.mode & 0o777
      if (stat.isSymbolicLink())
        return { path: target.path, required, status: "symlink", mode }
      if (!stat.isFile())
        return { path: target.path, required, status: "not-file", mode }
      if (hasUnsafeSymlink(target.path))
        return {
          path: target.path,
          required,
          status: "symlink",
          mode,
          detail: "路径中包含未允许的符号链接",
        }
      return {
        path: target.path,
        required,
        status:
          (mode & 0o077) === 0 && (mode & 0o600) === 0o600 ? "ok" : "too-open",
        mode,
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : ""
      if (code === "ENOENT")
        return { path: target.path, required, status: "missing" }
      return {
        path: target.path,
        required,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  })
}

export function hasBlockingPermissionFinding(
  findings: readonly PermissionFinding[]
): boolean {
  return findings.some(
    (finding) =>
      finding.status === "too-open" ||
      finding.status === "symlink" ||
      finding.status === "not-file" ||
      finding.status === "error" ||
      (finding.required && finding.status === "missing")
  )
}

/** Tighten only explicitly named regular files; symlinks are never followed. */
export function tightenPermissions(
  targets: readonly PermissionTarget[]
): PermissionFinding[] {
  for (const target of targets) {
    let fd: number | undefined
    try {
      const stat = lstatSync(target.path)
      if (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        !hasUnsafeSymlink(target.path)
      ) {
        // Apply the mode to the opened inode, never to the path. O_NOFOLLOW
        // closes the final-component symlink swap between lstat and chmod;
        // comparing the inode also avoids tightening a replacement file.
        fd = openSync(
          target.path,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
        )
        const opened = fstatSync(fd)
        if (
          opened.isFile() &&
          opened.dev === stat.dev &&
          opened.ino === stat.ino
        )
          fchmodSync(fd, RESTRICTED_FILE_MODE)
      }
    } catch {
      // The post-apply audit reports missing/unreadable targets precisely.
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  return auditPermissions(targets)
}

function explicitBackups(args: string[], cwd: string): PermissionTarget[] {
  const out: PermissionTarget[] = []
  for (const arg of args) {
    if (arg.startsWith("--backup=")) {
      const path = arg.slice("--backup=".length)
      if (path) out.push({ path: resolve(cwd, path) })
    }
  }
  return out
}

function usage(): string {
  return "用法：pnpm security:permissions -- [--apply] [--backup=/path/to/backup.bak]"
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes("--help")) {
    console.log(usage())
    return
  }
  const apply = args.includes("--apply")
  const cwd = process.cwd()
  const targets = [
    ...defaultPermissionTargets(cwd),
    ...explicitBackups(args, cwd),
  ]
  const before = auditPermissions(targets)
  const after = apply ? tightenPermissions(targets) : before
  console.log(JSON.stringify({ apply, before, after }, null, 2))
  if (hasBlockingPermissionFinding(after)) process.exitCode = 1
}

if (process.argv[1]?.endsWith("check-permissions.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
