import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const sidebar = readFileSync("components/ui/sidebar.tsx", "utf8")
const app = readFileSync("components/app-sidebar.tsx", "utf8")

describe("Base UI sidebar migration", () => {
  it("uses Base render primitives without Radix Slot/asChild", () => {
    expect(sidebar).toContain("@base-ui/react/use-render")
    expect(sidebar).toContain("@base-ui/react/merge-props")
    expect(sidebar).not.toContain('from "radix-ui"')
    expect(sidebar).not.toMatch(/\basChild\b/)
  })

  it("uses render for the navigation link consumer", () => {
    expect(app).toContain("render={<Link href={n.href} />}")
    expect(app).not.toContain("asChild")
  })

  it("closes the mobile drawer when a navigation link is clicked", () => {
    // 事件委托在移动端 Sheet 的内容包裹层:点任意 a[href] 即关抽屉,
    // 不必给每个菜单项各接一次 onClick;开启状态归 Sidebar 所有。
    expect(sidebar).toMatch(/closest\("a\[href\]"\)/)
    expect(sidebar).toContain("setOpenMobile(false)")
  })
})
