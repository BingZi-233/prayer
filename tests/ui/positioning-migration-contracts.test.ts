import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("Base UI overlay positioning migration contract", () => {
  it("uses Base UI overlay parts for Sheet, Popover, and Tooltip", async () => {
    const sources = await Promise.all(
      ["sheet", "popover", "tooltip"].map((name) =>
        readFile(`components/ui/${name}.tsx`, "utf8")
      )
    )
    const source = sources.join("\n")

    expect(source).toMatch(/@base-ui\/react\/(dialog|popover|tooltip)/)
    expect(source).toMatch(/\.Backdrop/)
    expect(source).toMatch(/\.Popup/)
    expect(source).toMatch(/\.Positioner/)
    expect(source).toMatch(/\.Arrow/)
    expect(source).toMatch(/\.Provider/)
    expect(source).not.toMatch(/radix-ui|@radix-ui/)
    expect(source).not.toMatch(/\.(Overlay|Content)|asChild/)
  })

  it("maps the Radix tooltip delay prop to Base UI delay", async () => {
    const source = await readFile("components/ui/tooltip.tsx", "utf8")
    expect(source).toMatch(/delayDuration/)
    expect(source).toMatch(/\bdelay=/)
  })
})
