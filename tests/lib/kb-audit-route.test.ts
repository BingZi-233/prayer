import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isAdminAuditRequestId } from "@/lib/core/admin-audit"

const { getAppContextMock, kbRoot, runIngestMock } = vi.hoisted(() => ({
  getAppContextMock: vi.fn(),
  kbRoot: { path: "" },
  runIngestMock: vi.fn(),
}))

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: getAppContextMock,
}))
vi.mock("@/scripts/ingest", () => ({
  runIngest: runIngestMock,
}))
vi.mock("@/lib/knowledge/kb-path", async () => {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const absolute = (rel: string): string | null =>
    !kbRoot.path || !rel || rel.startsWith("/") || rel.includes("..")
      ? null
      : path.join(kbRoot.path, rel)

  return {
    get KB_DIR() {
      return kbRoot.path
    },
    MAX_KB_FILE_BYTES: 512_000,
    createKbFileNoFollow(abs: string, content: string): boolean {
      try {
        fs.writeFileSync(abs, content, { encoding: "utf8", flag: "wx" })
        return true
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return false
        throw err
      }
    },
    isKbRelPath: (rel: string): boolean =>
      !rel.includes("..") && /\.(?:md|txt)$/.test(rel),
    readKbFileBoundedNoFollow: () => null,
    relFromParts: (parts: string[]): string => parts.join("/"),
    safeKbAbs: absolute,
    writeKbFileNoFollow(abs: string, content: string): boolean {
      if (!fs.existsSync(abs)) return false
      fs.writeFileSync(abs, content, "utf8")
      return true
    },
  }
})

import { POST as create } from "@/app/api/kb/route"
import {
  DELETE as remove,
  PATCH as rename,
  PUT as update,
} from "@/app/api/kb/[...file]/route"
import { POST as ingest } from "@/app/api/kb/ingest/route"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"

let db: ReturnType<typeof openDb>
let repo: Repo

function request(method: string, body?: unknown): Request {
  return new Request("http://x/api/kb", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  })
}

function context(file: string[]) {
  return { params: Promise.resolve({ file }) }
}

function expectAudit(
  response: Response,
  action: string,
  route: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE"
): void {
  const requestId = response.headers.get("x-request-id")
  expect(isAdminAuditRequestId(requestId)).toBe(true)
  expect(repo.adminAudit.getByRequestId(requestId!)).toMatchObject({
    action,
    route,
    method,
    result: "accepted",
    httpStatus: 200,
    detail: {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  kbRoot.path = mkdtempSync(join(tmpdir(), "prayer-kb-audit-route-"))
  db = openDb(":memory:", 3)
  repo = new Repo(db)
  getAppContextMock.mockReturnValue({ repo })
  runIngestMock.mockResolvedValue({ indexed: 1 })
})

afterEach(() => {
  vi.restoreAllMocks()
  db.close()
  rmSync(kbRoot.path, { recursive: true, force: true })
  kbRoot.path = ""
})

describe("KB mutation audit routes", () => {
  it("does not start an audit record before body or path validation", async () => {
    const response = await create(
      request("POST", { path: "../outside.md", content: "ignored" }) as never
    )

    expect(response.status).toBe(400)
    expect(repo.adminAudit.recent()).toEqual([])
    expect(existsSync(join(kbRoot.path, "outside.md"))).toBe(false)
  })

  it("records fixed, non-sensitive audit events and returns request ids", async () => {
    const created = await create(
      request("POST", { path: "create.md", content: "created" }) as never
    )
    expect(created.status).toBe(200)
    expectAudit(created, "kb.create", "/api/kb", "POST")
    expect(readFileSync(join(kbRoot.path, "create.md"), "utf8")).toBe("created")

    writeFileSync(join(kbRoot.path, "update.md"), "before")
    const updated = await update(
      request("PUT", { content: "after" }) as never,
      context(["update.md"])
    )
    expect(updated.status).toBe(200)
    expectAudit(updated, "kb.update", "/api/kb/[...file]", "PUT")
    expect(readFileSync(join(kbRoot.path, "update.md"), "utf8")).toBe("after")

    writeFileSync(join(kbRoot.path, "rename.md"), "rename")
    const renamed = await rename(
      request("PATCH", { newPath: "renamed.md" }) as never,
      context(["rename.md"])
    )
    expect(renamed.status).toBe(200)
    expectAudit(renamed, "kb.rename", "/api/kb/[...file]", "PATCH")
    expect(existsSync(join(kbRoot.path, "renamed.md"))).toBe(true)

    writeFileSync(join(kbRoot.path, "delete.md"), "delete")
    const deleted = await remove(
      request("DELETE") as never,
      context(["delete.md"])
    )
    expect(deleted.status).toBe(200)
    expectAudit(deleted, "kb.delete", "/api/kb/[...file]", "DELETE")
    expect(existsSync(join(kbRoot.path, "delete.md"))).toBe(false)

    const ingested = await ingest(request("POST") as never)
    expect(ingested.status).toBe(200)
    expectAudit(ingested, "kb.ingest", "/api/kb/ingest", "POST")
    expect(runIngestMock).toHaveBeenCalledWith(repo, "docs/kb")
  })

  it("fails closed before delete filesystem or index side effects when audit begin fails", async () => {
    const target = join(kbRoot.path, "delete.md")
    writeFileSync(target, "keep")
    const deleteKbDoc = vi.spyOn(repo, "deleteKbDoc")
    vi.spyOn(repo.adminAudit, "begin").mockImplementation(() => {
      throw new Error("audit unavailable")
    })

    const response = await remove(
      request("DELETE") as never,
      context(["delete.md"])
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      error: "审计服务暂不可用，本次变更未执行",
    })
    expect(isAdminAuditRequestId(response.headers.get("x-request-id"))).toBe(
      true
    )
    expect(existsSync(target)).toBe(true)
    expect(deleteKbDoc).not.toHaveBeenCalled()
  })
})
