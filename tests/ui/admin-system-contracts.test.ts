import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFile(file, "utf8")

describe("admin system page contracts", () => {
  it("renders the enabled-chat and plugin tables on the shared table shell", async () => {
    const [groups, plugins] = await Promise.all([
      read("app/admin/groups/page.tsx"),
      read("app/admin/plugins/page.tsx"),
    ])

    expect(groups).toContain("<TableShell")
    expect(groups).toContain("@/components/admin/table-shell")
    expect(plugins).toContain("<TableShell")
    expect(plugins).toContain("@/components/admin/table-shell")
  })

  it("collects secondary row actions into the shared row menu", async () => {
    const [groups, plugins] = await Promise.all([
      read("app/admin/groups/page.tsx"),
      read("app/admin/plugins/page.tsx"),
    ])

    expect(groups).toContain("<RowActions")
    expect(groups).toContain("@/components/admin/row-actions")
    expect(plugins).toContain("<RowActions")
    expect(plugins).toContain("@/components/admin/row-actions")
  })

  it("preserves enabled-chat toggling and policy override semantics", async () => {
    const source = await read("app/admin/groups/page.tsx")

    expect(source).toContain("policyWritePayload")
    expect(source).toContain("enabledChats")
    expect(source).toContain('body: JSON.stringify({ groupPolicies })')
    expect(source).toContain("clearPolicy")
  })

  it("preserves plugin lifecycle actions", async () => {
    const source = await read("app/admin/plugins/page.tsx")

    expect(source).toContain('action: p.enabled ? "disable" : "enable"')
    expect(source).toContain('action: "update"')
    expect(source).toContain('method: "DELETE"')
  })

  it("keeps configuration categories on the vertical settings tabs", async () => {
    const source = await read("app/admin/config/page.tsx")

    expect(source).toContain("orientation=\"vertical\"")
    expect(source).toContain("<CategoryHeader")
    expect(source).toContain("保存并生效")
  })
})
