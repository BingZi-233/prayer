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
    expect(source).toMatch(/sideOffset/)
    expect(source).toMatch(/alignOffset/)
    expect(source).toMatch(/collisionPadding/)
    expect(source).toMatch(/side=\{side\}/)
    expect(source).toMatch(/top-0[^"]*left-0[^"]*w-full/)
    expect(source).toMatch(/bottom-0[^"]*left-0[^"]*w-full/)
    expect(source).toMatch(/origin-\(--transform-origin\)/)
    expect(source).toMatch(/data-align-trigger/)
    expect(source).toMatch(/data-\[align-trigger=true\]:animate-none/)
    expect(source).toMatch(/data-\[side=none\]/)
    expect(source).toMatch(/data-\[side=none\]:data-starting-style:scale-100/)
    expect(source).toMatch(/data-\[side=none\]:data-starting-style:opacity-100/)
    expect(source).toMatch(
      /data-\[side=none\]:data-starting-style:transition-none/
    )
    expect(source).toMatch(
      /data-\[side=none\]:data-ending-style:transition-none/
    )
    expect(source).not.toMatch(/position\s*=/)
    expect(source).not.toMatch(/SelectPrimitive\.Viewport/)
  })
})
