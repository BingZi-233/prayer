import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("Base UI Tabs and ScrollArea migration contracts", () => {
  it("uses Base UI Tabs parts and maps active state", async () => {
    const source = await readFile("components/ui/tabs.tsx", "utf8")

    expect(source).toMatch(/@base-ui\/react\/tabs/)
    expect(source).toMatch(/TabsPrimitive\.Root/)
    expect(source).toMatch(/TabsPrimitive\.List/)
    expect(source).toMatch(/TabsPrimitive\.Tab/)
    expect(source).toMatch(/TabsPrimitive\.Panel/)
    expect(source).toMatch(/data-active/)
    expect(source).toMatch(/orientation/)
    expect(source).not.toMatch(/activationMode/)
    expect(source).not.toMatch(/radix-ui|@radix-ui/)
    expect(source).not.toMatch(/TabsPrimitive\.(Trigger|Content)/)
  })

  it("uses Base UI ScrollArea parts without Radix-only type propagation", async () => {
    const source = await readFile("components/ui/scroll-area.tsx", "utf8")

    expect(source).toMatch(/@base-ui\/react\/scroll-area/)
    expect(source).toMatch(/ScrollAreaPrimitive\.Root/)
    expect(source).toMatch(/ScrollAreaPrimitive\.Viewport/)
    expect(source).toMatch(/ScrollAreaPrimitive\.Scrollbar/)
    expect(source).toMatch(/ScrollAreaPrimitive\.Thumb/)
    expect(source).toMatch(/ScrollAreaPrimitive\.Corner/)
    expect(source).toMatch(/size-full/)
    expect(source).toMatch(/data-vertical:w-2\.5/)
    expect(source).not.toMatch(/ScrollAreaPrimitive\.ScrollAreaScrollbar/)
    expect(source).not.toMatch(/ScrollAreaPrimitive\.ScrollAreaThumb/)
    expect(source).not.toMatch(/type\??\s*:/)
    expect(source).not.toMatch(/radix-ui|@radix-ui/)
  })
})
