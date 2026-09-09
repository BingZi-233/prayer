import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("Base UI dialog migration contract", () => {
  it("maps Dialog parts to Base UI Backdrop, Popup, and Close", async () => {
    const source = await readFile("components/ui/dialog.tsx", "utf8")

    expect(source).toMatch(/@base-ui\/react\/dialog/)
    expect(source).toMatch(/DialogPrimitive\.Backdrop/)
    expect(source).toMatch(/DialogPrimitive\.Popup/)
    expect(source).toMatch(/DialogPrimitive\.Close/)
    expect(source).not.toMatch(/radix-ui|@radix-ui/)
    expect(source).not.toMatch(/DialogPrimitive\.(Overlay|Content)|asChild/)
  })

  it("keeps Dialog children narrowed to ReactNode for Radix-compatible consumers", async () => {
    const source = await readFile("components/ui/dialog.tsx", "utf8")

    expect(source).toMatch(
      /Omit<React\.ComponentProps<typeof DialogPrimitive\.Root>, "children">/
    )
    expect(source).toMatch(/children\?: React\.ReactNode/)
  })

  it("maps AlertDialog parts to Base UI Backdrop, Popup, and Close", async () => {
    const source = await readFile("components/ui/alert-dialog.tsx", "utf8")

    expect(source).toMatch(/@base-ui\/react\/alert-dialog/)
    expect(source).toMatch(/AlertDialogPrimitive\.Backdrop/)
    expect(source).toMatch(/AlertDialogPrimitive\.Popup/)
    expect(source).toMatch(
      /render=\{<AlertDialogPrimitive\.Close data-slot="alert-dialog-action" \/>\}/
    )
    expect(source).toMatch(
      /render=\{<AlertDialogPrimitive\.Close data-slot="alert-dialog-cancel" \/>\}/
    )
    expect(source).not.toMatch(/radix-ui|@radix-ui/)
    expect(source).not.toMatch(
      /AlertDialogPrimitive\.(Overlay|Content|Cancel|Action)|asChild/
    )
  })

  it("keeps the sessions multi-step action open until the final step", async () => {
    const source = await readFile("app/admin/sessions/page.tsx", "utf8")

    expect(source).toMatch(/e\.preventDefault\(\)\s+e\.preventBaseUIHandler\(\)/)
  })
})
