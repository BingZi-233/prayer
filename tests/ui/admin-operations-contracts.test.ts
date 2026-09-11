import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFile(file, "utf8")

describe("admin operations workbench contracts", () => {
  it("renders the handoff and proactive tables on the shared table shell", async () => {
    const [handoff, proactive] = await Promise.all([
      read("app/admin/handoff/page.tsx"),
      read("app/admin/proactive/page.tsx"),
    ])

    expect(handoff).toContain("<TableShell")
    expect(handoff).toContain("@/components/admin/table-shell")
    expect(proactive).toContain("<TableShell")
    expect(proactive).toContain("@/components/admin/table-shell")
  })

  it("keeps the sticky table header contract in one place", async () => {
    const css = await read("app/globals.css")
    expect(css).toContain('[data-slot="table-shell"]')
    expect(css).toMatch(
      /\[data-slot="table-shell"\]\s*\[data-slot="table-header"\]\s*\{[^}]*position:\s*sticky/
    )
  })

  it("preserves the sessions workbench layout and handoff semantics", async () => {
    const [page, hook] = await Promise.all([
      read("app/admin/sessions/page.tsx"),
      read("components/admin/sessions/use-session-selection.ts"),
    ])
    const source = page + "\n" + hook

    expect(source).toContain("<MasterDetail")
    expect(source).toContain('backLabel="返回会话列表"')
    expect(source).toContain('"resume_handoff"')
    expect(source).toContain('"reset_all"')
    expect(source).toContain("syncUrl(")
    expect(source).toContain("createSessionListCoordinator")
  })

  it("keeps the mobile master-detail back flow mounted", async () => {
    const source = await read("components/admin/master-detail.tsx")

    expect(source).toContain('selected && "hidden"')
    expect(source).toContain('!selected && "hidden"')
  })

  it("keeps handoff resume and proactive quality actions wired to their APIs", async () => {
    const [handoff, proactive] = await Promise.all([
      read("app/admin/handoff/page.tsx"),
      read("app/admin/proactive/page.tsx"),
    ])

    expect(handoff).toContain('action: "resume_handoff"')
    expect(handoff).toContain("await refresh({ force: true })")
    expect(proactive).toContain('method: "PATCH"')
    expect(proactive).toContain("quality")
    expect(proactive).toContain("await refresh({ force: true })")
  })
})
