import { describe, expect, it } from "vitest"
import {
  adminAuditActorType,
  createAdminAuditCompletion,
  createAdminAuditRequestId,
  createAdminAuditStart,
  isAdminAuditRequestId,
  normalizeAdminAuditDetail,
} from "@/lib/core/admin-audit"

const descriptor = {
  action: "config.update",
  route: "/api/config",
  method: "PUT" as const,
}

describe("admin audit semantics", () => {
  it("records proxy's coarse authorization model, not identity or transport", () => {
    expect(adminAuditActorType(false)).toBe("development-unprotected")
    expect(adminAuditActorType(true)).toBe("shared-admin-token")
  })

  it("uses only a server-generated UUID as the request correlation id", () => {
    expect(isAdminAuditRequestId(createAdminAuditRequestId())).toBe(true)
    expect(isAdminAuditRequestId("caller-provided-request-id")).toBe(false)
  })

  it("builds a constrained mutation start", () => {
    const start = createAdminAuditStart(descriptor, 100, true)
    expect(start).toMatchObject({
      ...descriptor,
      actorType: "shared-admin-token",
      startedAt: 100,
    })
    expect(isAdminAuditRequestId(start.requestId)).toBe(true)
    expect(() =>
      createAdminAuditStart(
        { ...descriptor, route: "/api/config?token=secret" },
        100,
        false
      )
    ).toThrow("管理审计 route 非法")
  })

  it("keeps detail non-sensitive, fixed-shape, and bounded", () => {
    expect(
      normalizeAdminAuditDetail({
        changed_count: 2,
        dry_run: false,
        source_missing: null,
      })
    ).toEqual({ changed_count: 2, dry_run: false, source_missing: null })
    expect(() =>
      normalizeAdminAuditDetail({ token: "secret" } as never)
    ).toThrow("管理审计详情不能包含标识符或原始内容字段")
    expect(() => normalizeAdminAuditDetail({ user_id: 42 })).toThrow(
      "管理审计详情不能包含标识符或原始内容字段"
    )
    expect(() => normalizeAdminAuditDetail(["request body"] as never)).toThrow(
      "管理审计详情必须是普通对象"
    )
  })

  it("derives an HTTP outcome without claiming atomic external side effects", () => {
    expect(createAdminAuditCompletion(201, 101).result).toBe("accepted")
    expect(createAdminAuditCompletion(400, 101).result).toBe("rejected")
    expect(createAdminAuditCompletion(500, 101).result).toBe("failed")
    expect(createAdminAuditCompletion(503, 101, { partial: true }).result).toBe(
      "partial"
    )
    expect(() => createAdminAuditCompletion(99, 101)).toThrow(
      "HTTP 状态码必须在 100 到 599 之间"
    )
  })
})
