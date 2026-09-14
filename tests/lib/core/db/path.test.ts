import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import {
  canonicalDbPath,
  databaseOpenPath,
  filesystemDbPath,
} from "@/lib/core/db/path"
import { openDb } from "@/lib/core/db"
import { defaultPermissionTargets } from "@/scripts/check-permissions"

describe("canonicalDbPath", () => {
  it("keeps SQLite URI paths and resolves ordinary paths from the supplied base", () => {
    expect(canonicalDbPath(":memory:", "/tmp/prayer")).toBe(":memory:")
    expect(canonicalDbPath("file:/tmp/prayer.db", "/tmp/prayer")).toBe(
      "file:/tmp/prayer.db"
    )
    expect(canonicalDbPath("data/agent.db", "/tmp/prayer")).toBe(
      "/tmp/prayer/data/agent.db"
    )
  })

  it("maps only local absolute file URIs for filesystem audits", () => {
    expect(filesystemDbPath(":memory:", "/tmp/prayer")).toBeNull()
    expect(filesystemDbPath("file:///tmp/prayer.db", "/tmp/prayer")).toBe(
      "/tmp/prayer.db"
    )
    expect(
      filesystemDbPath("file:///tmp/prayer.db?mode=rwc", "/tmp/prayer")
    ).toBe("/tmp/prayer.db")
    expect(filesystemDbPath("file:./agent.db", "/tmp/prayer")).toBeNull()
    expect(filesystemDbPath("file://remote/tmp/prayer.db", "/tmp/prayer")).toBeNull()
  })

  it("normalizes only option-free local file URIs for better-sqlite3", () => {
    expect(databaseOpenPath("file:///tmp/prayer.db", "/tmp/prayer")).toBe(
      "/tmp/prayer.db"
    )
    expect(() =>
      databaseOpenPath("file:///tmp/prayer.db?mode=rwc", "/tmp/prayer")
    ).toThrow(/不能包含 query 或 fragment/)
    expect(() => databaseOpenPath("file:./agent.db", "/tmp/prayer")).toThrow(
      /本机绝对文件 URI/
    )
    expect(() =>
      databaseOpenPath("file://remote/tmp/prayer.db", "/tmp/prayer")
    ).toThrow(/本机绝对文件 URI/)
  })

  it("opens a local file URI through the shared database entry point", () => {
    const directory = mkdtempSync(join(tmpdir(), "prayer-db-uri-"))
    const path = join(directory, "agent.db")
    try {
      const db = openDb(pathToFileURL(path).href, 3)
      expect(db.open).toBe(true)
      expect(db.name).toBe(path)
      db.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("audits local file URI targets without treating the URI as a filename", () => {
    const paths = defaultPermissionTargets("/tmp/prayer", {
      NODE_ENV: "test",
      DB_PATH: "file:///tmp/agent.db",
      CLAUDE_CONFIG_DIR: "./claude-config",
    }).map((target) => target.path)
    expect(paths).toContain("/tmp/agent.db")
    expect(paths).toContain("/tmp/agent.db-wal")
    expect(paths).not.toContain("/tmp/prayer/file:/tmp/agent.db")
  })
})
