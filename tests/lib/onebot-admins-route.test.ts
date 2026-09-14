import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { loadGroupMembersMock, collectAdminsMock } = vi.hoisted(() => ({
  loadGroupMembersMock: vi.fn(),
  collectAdminsMock: vi.fn(() => [] as unknown),
}))

vi.mock("@/lib/core/app-context", () => ({
  getAppContext: () => ({
    cfg: {
      botQQ: 999,
      enabledChats: [],
    },
  }),
}))
vi.mock("@/lib/channels/qq/admins", () => ({
  collectAdmins: collectAdminsMock,
}))
vi.mock("@/lib/channels/qq/members-fetch", () => ({
  loadGroupMembers: loadGroupMembersMock,
  toAdminMemberShape: (rows: unknown[]) => rows,
}))
vi.mock("@/lib/runtime", () => ({
  getRuntime: () => ({ getGroupMembers: vi.fn() }),
}))

import { GET, MAX_ADMIN_GROUPS } from "@/app/api/onebot/admins/route"

beforeEach(() => {
  loadGroupMembersMock.mockReset()
  collectAdminsMock.mockClear()
})

describe("GET /api/onebot/admins", () => {
  it("rejects an over-limit groups query before calling OneBot", async () => {
    const groups = Array.from({ length: MAX_ADMIN_GROUPS + 1 }, (_, i) =>
      String(i + 1)
    ).join(",")
    const res = await GET(
      new NextRequest(`http://x/api/onebot/admins?groups=${groups}`)
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain(String(MAX_ADMIN_GROUPS))
    expect(loadGroupMembersMock).not.toHaveBeenCalled()
  })

  it("keeps an in-limit query on the normal path", async () => {
    loadGroupMembersMock.mockResolvedValue([{ user_id: 1, role: "admin" }])
    const res = await GET(
      new NextRequest("http://x/api/onebot/admins?groups=1,2")
    )
    expect(res.status).toBe(200)
    expect(loadGroupMembersMock).toHaveBeenCalledTimes(2)
  })
})
