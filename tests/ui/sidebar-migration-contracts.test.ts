import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const sidebar = readFileSync("components/ui/sidebar.tsx", "utf8")
const app = readFileSync("components/app-sidebar.tsx", "utf8")

describe("Base UI sidebar migration", () => {
  it("uses Base render primitives without Radix Slot/asChild", () => {
    expect(sidebar).toContain('@base-ui/react/use-render')
    expect(sidebar).toContain('@base-ui/react/merge-props')
    expect(sidebar).not.toContain('from "radix-ui"')
    expect(sidebar).not.toMatch(/\basChild\b/)
  })

  it("uses render for the navigation link consumer", () => {
    expect(app).toContain('render={<Link href={n.href} />}')
    expect(app).not.toContain("asChild")
  })
})
