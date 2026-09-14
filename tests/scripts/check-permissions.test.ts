import { afterEach, describe, expect, it } from "vitest"
import {
  chmodSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  auditPermissions,
  defaultPermissionTargets,
  hasBlockingPermissionFinding,
  tightenPermissions,
} from "@/scripts/check-permissions"

describe("check-permissions", () => {
  let root: string | undefined

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  it("detects and tightens group/other-readable files", () => {
    root = join(tmpdir(), `prayer-permissions-${Date.now()}-${Math.random()}`)
    mkdirSync(root, { recursive: true })
    const path = join(root, "settings.json")
    writeFileSync(path, "{}")
    chmodSync(path, 0o644)

    const before = auditPermissions([{ path, required: true }])
    expect(before[0]).toMatchObject({ status: "too-open", mode: 0o644 })
    expect(hasBlockingPermissionFinding(before)).toBe(true)

    const after = tightenPermissions([{ path, required: true }])
    expect(after[0]).toMatchObject({ status: "ok", mode: 0o600 })
    expect(hasBlockingPermissionFinding(after)).toBe(false)
  })

  it("reports missing optional files but never follows symlinks", () => {
    root = join(tmpdir(), `prayer-permissions-${Date.now()}-${Math.random()}`)
    mkdirSync(root, { recursive: true })
    const outside = join(root, "outside")
    const link = join(root, "cache.json")
    writeFileSync(outside, "secret")
    symlinkSync(outside, link)

    expect(
      auditPermissions([{ path: join(root, "missing"), required: false }])
    ).toMatchObject([{ status: "missing", required: false }])
    const finding = auditPermissions([{ path: link }])[0]
    expect(finding).toMatchObject({ status: "symlink" })
    expect(hasBlockingPermissionFinding([finding!])).toBe(true)

    // Applying permissions to a final symlink must not alter its target.
    expect(tightenPermissions([{ path: link }])).toMatchObject([
      { status: "symlink" },
    ])
    expect(auditPermissions([{ path: outside }])[0]).toMatchObject({
      status: "too-open",
      mode: 0o644,
    })
  })

  it("rejects an intermediate symlink before chmod", () => {
    root = join(tmpdir(), `prayer-permissions-${Date.now()}-${Math.random()}`)
    const target = join(root, "target")
    const linked = join(root, "linked")
    mkdirSync(join(target, "nested"), { recursive: true })
    const outside = join(target, "nested", "settings.json")
    writeFileSync(outside, "secret")
    chmodSync(outside, 0o644)
    symlinkSync(target, linked)

    const path = join(linked, "nested", "settings.json")
    expect(auditPermissions([{ path }])).toMatchObject([
      { status: "symlink", mode: 0o644 },
    ])
    expect(tightenPermissions([{ path }])).toMatchObject([
      { status: "symlink", mode: 0o644 },
    ])
    expect(auditPermissions([{ path: outside }])[0]).toMatchObject({
      status: "too-open",
      mode: 0o644,
    })
  })

  it("覆盖 Claude 常见凭据副本,但不递归 transcript 目录", () => {
    const cwd = join(tmpdir(), `prayer-permissions-targets-${Date.now()}`)
    const paths = defaultPermissionTargets(cwd, {
      NODE_ENV: "test",
      DB_PATH: ":memory:",
      CLAUDE_CONFIG_DIR: "./claude-config",
    }).map((target) => target.path)
    expect(paths).toContain(join(cwd, "claude-config", "settings.json"))
    expect(paths).toContain(join(cwd, "claude-config", "settings copy.json"))
    expect(paths).toContain(join(cwd, "claude-config", ".claude.json"))
    expect(paths.some((path) => path.includes("projects"))).toBe(false)
  })
})
