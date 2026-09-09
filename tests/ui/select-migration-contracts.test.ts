import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("Base UI Select migration contract", () => {
  it("uses Base UI Select parts and preserves the positioning contract", async () => {
    const source = await readFile("components/ui/select.tsx", "utf8")

    expect(source).toMatch(/@base-ui\/react\/select/)
    expect(source).toMatch(/SelectPrimitive\.Root/)
    expect(source).toMatch(/SelectPrimitive\.Portal/)
    expect(source).toMatch(/SelectPrimitive\.Positioner/)
    expect(source).toMatch(/SelectPrimitive\.Popup/)
    expect(source).toMatch(/SelectPrimitive\.List/)
    expect(source).toMatch(/SelectPrimitive\.ItemText/)
    expect(source).toMatch(/SelectPrimitive\.ItemIndicator/)
    expect(source).toMatch(/SelectPrimitive\.ScrollUpArrow/)
    expect(source).toMatch(/SelectPrimitive\.ScrollDownArrow/)
    expect(source).toMatch(/alignItemWithTrigger/)
    expect(source).not.toMatch(/position\s*=/)
    expect(source).not.toMatch(/SelectPrimitive\.Viewport/)
  })
})
