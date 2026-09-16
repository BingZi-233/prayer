import { execFile } from "node:child_process"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { DAY_MS } from "@/lib/core/db/retention"
import { openDb } from "@/lib/core/db/index"
import { inspectDatabaseReport } from "@/scripts/db-maintenance"

const run = promisify(execFile)
const NOW = Date.UTC(2026, 8, 16, 0, 0, 0)
const OLD = NOW - 91 * DAY_MS
const databases: Database.Database[] = []
const directories: string[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) if (db.open) db.close()
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true }))
  )
})

function database(): Database.Database {
  const db = openDb(":memory:", 3)
  databases.push(db)
  return db
}

describe("db-maintenance report", () => {
  it("reports retention and delivery state without deleting rows", () => {
    const db = database()
    const insert = db.prepare(
      "INSERT INTO outbox_messages(delivery_key,action_json,status,attempts,next_attempt_at,sent_at) VALUES (?, '{}', ?, 1, 0, ?)"
    )
    insert.run("old-sent", "sent", OLD)
    insert.run("failed", "failed", null)

    const report = inspectDatabaseReport(db, NOW)

    expect(report.integrity).toEqual({ ok: true, messages: ["ok"] })
    expect(report.outbox).toEqual({
      pending: 0,
      sending: 0,
      sent: 1,
      failed: 1,
    })
    expect(
      report.retention.tables.find((table) => table.table === "outbox_messages")
    ).toMatchObject({ candidates: 1, available: true })
    expect(
      db
        .prepare("SELECT delivery_key, status FROM outbox_messages ORDER BY id")
        .all()
    ).toEqual([
      { delivery_key: "old-sent", status: "sent" },
      { delivery_key: "failed", status: "failed" },
    ])
  })

  it("keeps partial-schema diagnostics visible instead of querying a missing outbox", () => {
    const db = database()
    db.exec("DROP TABLE outbox_messages")

    const report = inspectDatabaseReport(db, NOW)

    expect(report.outbox).toBeNull()
    expect(
      report.retention.tables.find((table) => table.table === "outbox_messages")
    ).toMatchObject({ available: false })
  })

  it("runs the CLI in readonly mode and emits machine-readable JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prayer-db-report-"))
    directories.push(directory)
    const path = join(directory, "source.db")
    const source = openDb(path, 3)
    source
      .prepare(
        "INSERT INTO outbox_messages(delivery_key,action_json,status,attempts,next_attempt_at,sent_at) VALUES (?, '{}', 'sent', 1, 0, ?)"
      )
      .run("old-sent", OLD)
    source.close()
    const before = await readFile(path)

    const { stdout } = await run(
      process.execPath,
      [
        "--experimental-transform-types",
        "scripts/db-maintenance.ts",
        "report",
        `--now=${NOW}`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DB_PATH: path },
      }
    )
    const report = JSON.parse(stdout) as {
      ok: boolean
      source: string
      checkedAt: number
      outbox: { sent: number }
    }

    expect(report).toMatchObject({
      ok: true,
      source: path,
      checkedAt: NOW,
      outbox: { sent: 1 },
    })
    expect(await readFile(path)).toEqual(before)
    expect(
      (await readdir(directory)).some((name) => name.endsWith(".bak"))
    ).toBe(false)
  })

  it("exits nonzero while preserving JSON diagnostics for a partial schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prayer-db-report-partial-"))
    directories.push(directory)
    const path = join(directory, "partial.db")
    const source = openDb(path, 3)
    source.exec("DROP TABLE outbox_messages")
    source.close()

    await expect(
      run(
        process.execPath,
        [
          "--experimental-transform-types",
          "scripts/db-maintenance.ts",
          "report",
          path,
          `--now=${NOW}`,
        ],
        { cwd: process.cwd(), encoding: "utf8" }
      )
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"ok": false'),
    })
  })
})
