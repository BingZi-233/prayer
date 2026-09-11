import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getAppContext } from "@/lib/core/app-context"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("application data context", () => {
  it("reuses config and business repositories for the same paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "prayer-context-"))
    dirs.push(dir)
    const dbPath = join(dir, "config.db")
    const first = getAppContext({ DB_PATH: dbPath })
    const second = getAppContext({ DB_PATH: dbPath })
    expect(first.cfg.dbPath).toBe(dbPath)
    expect(first.configRepo).toBe(second.configRepo)
    expect(first.repo).toBe(second.repo)
  })

  it("keeps config and business repositories on their respective databases", () => {
    const dir = mkdtempSync(join(tmpdir(), "prayer-context-"))
    dirs.push(dir)
    const configPath = join(dir, "config.db")
    const businessPath = join(dir, "business.db")
    const first = getAppContext({ DB_PATH: configPath })
    // Persisting an explicit config value must make the business repository follow it.
    first.configRepo.setConfigRow("app", JSON.stringify({ ...first.cfg, dbPath: businessPath }))
    const second = getAppContext({ DB_PATH: configPath })
    expect(second.cfg.dbPath).toBe(businessPath)
    expect(second.configRepo).toBe(first.configRepo)
    expect(second.repo).not.toBe(first.configRepo)
    second.repo.setSessionId("qq:100", "session-business")
    expect(second.repo.getSessionId("qq:100")).toBe("session-business")
    expect(second.configRepo.getSessionId("qq:100")).toBeUndefined()
  })
})
