import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFile(file, "utf8")

describe("admin system page contracts", () => {
  it("renders the enabled-chat and plugin tables on the shared table shell", async () => {
    const [groupsPage, groupsTable, plugins] = await Promise.all([
      read("app/admin/groups/page.tsx"),
      read("components/admin/groups/group-table.tsx"),
      read("app/admin/plugins/page.tsx"),
    ])
    const groups = groupsPage + "\n" + groupsTable

    expect(groups).toContain("<TableShell")
    expect(groups).toContain("@/components/admin/table-shell")
    expect(plugins).toContain("<TableShell")
    expect(plugins).toContain("@/components/admin/table-shell")
  })

  it("collects secondary row actions into the shared row menu", async () => {
    const [groupsPage, groupsTable, plugins] = await Promise.all([
      read("app/admin/groups/page.tsx"),
      read("components/admin/groups/group-table.tsx"),
      read("app/admin/plugins/page.tsx"),
    ])
    const groups = groupsPage + "\n" + groupsTable

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

  it("keeps configuration categories on the shared horizontal tabs", async () => {
    const source = await read("app/admin/config/page.tsx")

    // 与其余页面同一套标签语言:横向 TabsList + 卡片网格
    expect(source).toContain("CATEGORIES.map")
    expect(source).toContain("<TabsList")
    expect(source).toContain("<SettingsGrid>")
    expect(source).not.toContain("orientation=\"vertical\"")
    expect(source).toContain("保存并生效")
  })
})
