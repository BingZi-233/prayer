import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createAdminAuditCompletion,
  createAdminAuditStart,
} from "@/lib/core/admin-audit"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import type Database from "better-sqlite3"

let db: Database.Database
let repo: Repo

function start(startedAt: number) {
  return createAdminAuditStart(
    { action: "config.update", route: "/api/config", method: "PUT" },
    startedAt,
    true
  )
}

describe("admin audit repository", () => {
  beforeEach(() => {
    db = openDb(":memory:", 3)
    repo = new Repo(db)
  })

  afterEach(() => db.close())

  it("persists a start, then finalizes it exactly once", () => {
    const entry = start(100)
    const id = repo.adminAudit.begin(entry)

    expect(repo.adminAudit.get(id)).toEqual({
      id,
      requestId: entry.requestId,
      actorType: "shared-admin-token",
      action: "config.update",
      route: "/api/config",
      method: "PUT",
      result: "started",
      httpStatus: null,
      detail: {},
      startedAt: 100,
      finishedAt: null,
    })
    expect(
      repo.adminAudit.finish(
        id,
        createAdminAuditCompletion(204, 101, {
          detail: { changed_count: 2 },
        })
      )
    ).toBe(true)
    expect(
      repo.adminAudit.finish(id, createAdminAuditCompletion(204, 102))
    ).toBe(false)
    expect(repo.adminAudit.get(id)).toMatchObject({
      result: "accepted",
      httpStatus: 204,
      detail: { changed_count: 2 },
      finishedAt: 101,
    })
  })

  it("supports correlation lookup and exposes unfinished records", () => {
    const first = repo.adminAudit.begin(start(100))
    const secondEntry = start(200)
    const second = repo.adminAudit.begin(secondEntry)
    expect(
      repo.adminAudit.finish(second, createAdminAuditCompletion(200, 201))
    ).toBe(true)

    expect(repo.adminAudit.getByRequestId(secondEntry.requestId)?.id).toBe(
      second
    )
    expect(repo.adminAudit.recent(2).map((event) => event.id)).toEqual([
      second,
      first,
    ])
    expect(repo.adminAudit.unfinished().map((event) => event.id)).toEqual([
      first,
    ])
    expect(() => repo.adminAudit.recent(0)).toThrow(
      "管理审计查询条数必须在 1 到 500 之间"
    )
  })

  it("rejects sensitive detail before it can be stored", () => {
    const id = repo.adminAudit.begin(start(100))
    expect(() =>
      repo.adminAudit.finish(
        id,
        createAdminAuditCompletion(200, 101, {
          detail: { token: "secret" } as never,
        })
      )
    ).toThrow("管理审计详情不能包含标识符或原始内容字段")
    expect(repo.adminAudit.get(id)).toMatchObject({
      result: "started",
      detail: {},
    })
  })

  it("participates in the enclosing repository transaction", () => {
    expect(() =>
      repo.transaction(() => {
        repo.adminAudit.begin(start(100))
        throw new Error("rollback")
      })
    ).toThrow("rollback")
    expect(repo.adminAudit.recent()).toEqual([])
  })
})
