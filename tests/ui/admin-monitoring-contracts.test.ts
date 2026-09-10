import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("admin monitoring render contracts", () => {
  it("keeps the token login in a branded, accessible card shell", async () => {
    const source = await readFile("app/login/page.tsx", "utf8")

    expect(source).toContain('fetch("/api/auth/login"')
    expect(source).toContain("aria-busy={busy}")
    expect(source).toContain("<CardFooter")
    expect(source).toContain("bg-muted/40")
  })

  it("gives runtime usage loading, error, and empty states a shared contract", async () => {
    const source = await readFile("app/admin/page.tsx", "utf8")

    expect(source).toContain("import { DataState, EmptyState }")
    expect(source).toContain("usageError")
    expect(source).toContain("usageLoading")
    expect(source).toContain("empty={usage?.rows.length === 0}")
    expect(source).toContain("statusLabel(s.state)")
  })

  it("uses localized level labels without losing the bounded log viewport", async () => {
    const source = await readFile("app/admin/logs/page.tsx", "utf8")

    expect(source).toContain("LEVEL_LABEL")
    expect(source).toContain('info: "信息"')
    expect(source).toContain('warn: "警告"')
    expect(source).toContain('error: "错误"')
    expect(source).toContain("w-full sm:w-52")
  })

  it("announces shared data states to assistive technology", async () => {
    const source = await readFile("components/admin/data-state.tsx", "utf8")

    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('role="status"')
  })
})
