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

  it("the Badge wrapper uses Base UI render composition", async () => {
    const source = await read("components/ui/badge.tsx")
    expect(source).toMatch(/@base-ui\/react\/use-render/)
    expect(source).toMatch(/@base-ui\/react\/merge-props/)
    expect(source).not.toMatch(/Slot/)
  })

  it("the BubbleContent wrapper uses Base UI render composition", async () => {
    const source = await read("components/ui/bubble.tsx")
    expect(source).toMatch(/@base-ui\/react\/use-render/)
    expect(source).toMatch(/@base-ui\/react\/merge-props/)
    expect(source).not.toMatch(/Slot/)
  })

  it("the Label wrapper uses a native label element", async () => {
    const source = await read("components/ui/label.tsx")
    expect(source).toMatch(/React\.ComponentProps<"label">/)
    expect(source).not.toMatch(/radix-ui|@radix-ui|LabelPrimitive/)
  })

  it("the Separator wrapper uses the callable Base UI primitive", async () => {
    const source = await read("components/ui/separator.tsx")
    expect(source).toMatch(/@base-ui\/react\/separator/)
    expect(source).toMatch(/<SeparatorPrimitive(?:\s|>)/)
    expect(source).not.toMatch(/SeparatorPrimitive\.Root/)
    expect(source).not.toMatch(/decorative|radix-ui|@radix-ui/)
  })

  it("the Checkbox wrapper uses Base UI checkbox parts", async () => {
    const source = await read("components/ui/checkbox.tsx")
    expect(source).toMatch(/@base-ui\/react\/checkbox/)
    expect(source).toMatch(/CheckboxPrimitive\.Root/)
    expect(source).toMatch(/CheckboxPrimitive\.Indicator/)
    expect(source).not.toMatch(/radix-ui|@radix-ui/)
  })

  it("the Switch wrapper uses Base UI switch parts", async () => {
    const source = await read("components/ui/switch.tsx")
    expect(source).toMatch(/@base-ui\/react\/switch/)
    expect(source).toMatch(/SwitchPrimitive\.Root/)
    expect(source).toMatch(/SwitchPrimitive\.Thumb/)
    expect(source).not.toMatch(/radix-ui|@radix-ui/)
  })
})
