import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFile(path, "utf8")

describe("Base UI migration contract", () => {
  it("all migrated wrappers contain no Radix import", async () => {
    const paths = [
      "components/ui/alert-dialog.tsx",
      "components/ui/badge.tsx",
      "components/ui/bubble.tsx",
      "components/ui/button.tsx",
      "components/ui/checkbox.tsx",
      "components/ui/dialog.tsx",
      "components/ui/label.tsx",
      "components/ui/popover.tsx",
      "components/ui/scroll-area.tsx",
      "components/ui/select.tsx",
      "components/ui/separator.tsx",
      "components/ui/sheet.tsx",
      "components/ui/sidebar.tsx",
      "components/ui/switch.tsx",
      "components/ui/tabs.tsx",
      "components/ui/tooltip.tsx",
    ]
    const sources = await Promise.all(paths.map(read))
    expect(sources.join("\n")).not.toMatch(/radix-ui|@radix-ui/)
  })

  it("the project points shadcn at base-mira", async () => {
    const config = JSON.parse(await read("components.json")) as { style: string }
    expect(config.style).toBe("base-mira")
  })

  it("the Button wrapper uses the Base UI primitive and render composition", async () => {
    const source = await read("components/ui/button.tsx")
    expect(source).toMatch(/@base-ui\/react\/button/)
    expect(source).toMatch(/ButtonPrimitive/)
    expect(source).not.toMatch(/radix-ui|@radix-ui|Slot\.Root/)
  })
})
