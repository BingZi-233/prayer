import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFile(path, "utf8")

const isRadixPackage = (name: string) =>
  name === "radix-ui" || name === "@radix-ui" || name.startsWith("@radix-ui/")

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(entryPath)
      return /\.tsx?$/.test(entry.name) ? [entryPath] : []
    })
  )
  return nested.flat()
}

function radixModuleReferences(source: string): string[] {
  const file = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true)
  const references: string[] = []
  const addReference = (specifier: ts.Expression) => {
    if (ts.isStringLiteral(specifier) && isRadixPackage(specifier.text)) {
      references.push(specifier.text)
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) addReference(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      addReference(node.moduleReference.expression)
    } else if (ts.isCallExpression(node)) {
      const [specifier] = node.arguments
      if (
        (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        if (specifier) addReference(specifier)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return references
}

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

  it("the direct dependency guard recognizes bundled and scoped Radix packages", () => {
    const dependencies = {
      "@base-ui/react": "1.6.0",
      "@radix-ui/react-dialog": "1.1.23",
      "radix-ui": "1.6.7",
    }
    expect(Object.keys(dependencies).filter(isRadixPackage)).toEqual([
      "@radix-ui/react-dialog",
      "radix-ui",
    ])
  })

  it("the source guard recognizes imports and requires without matching plain strings", () => {
    expect(
      radixModuleReferences(`
        import { Dialog } from "@radix-ui/react-dialog"
        const legacy = require("radix-ui")
      `)
    ).toEqual(["@radix-ui/react-dialog", "radix-ui"])
    expect(
      radixModuleReferences(
        'const report = "import { Dialog } from @radix-ui/react-dialog"; const state = "data-[state=selected]"'
      )
    ).toEqual([])
  })

  it("the project has no direct Radix dependency", async () => {
    const pkg = JSON.parse(await read("package.json")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(isRadixPackage)).toEqual([])
    const lockfile = await read("pnpm-lock.yaml")
    expect(lockfile).not.toMatch(/(^|\n)\s*radix-ui@/)
  })

  it("all source files contain no Radix import or require", async () => {
    const paths = (await Promise.all(["components", "app", "lib"].map(sourceFiles))).flat()
    const references = await Promise.all(
      paths.map(async (sourcePath) => ({
        sourcePath,
        references: radixModuleReferences(await read(sourcePath)),
      }))
    )
    expect(
      references
        .filter(({ references }) => references.length > 0)
        .map(({ sourcePath, references }) => `${sourcePath}: ${references.join(", ")}`)
    ).toEqual([])
  })

  it("KB tab panels do not rely on stale Radix inactive selectors", async () => {
    const source = await read("app/admin/kb/page.tsx")
    expect(source).not.toMatch(/data-\[state=inactive\]:hidden/)
  })

  it("uses the check-cx typography and amber theme tokens", async () => {
    const [globals, layout] = await Promise.all([
      read("app/globals.css"),
      read("app/layout.tsx"),
    ])
    expect(globals).toContain("--font-sans: var(--font-inter)")
    expect(globals).toContain("--font-mono: var(--font-geist-mono)")
    expect(globals).toContain("--primary: oklch(0.67 0.16 58)")
    expect(layout).toContain("Inter")
    expect(layout).toContain("Geist_Mono")
    expect(layout).not.toContain("JetBrains_Mono")
    expect(layout).not.toMatch(/className=.*font-mono/)
  })

  it("keeps the base Card density and focus ring contract", async () => {
    const source = await read("components/ui/card.tsx")
    expect(source).toContain("group/card")
    expect(source).toContain("text-xs/relaxed")
    expect(source).toContain("ring-1 ring-foreground/10")
    expect(source).toContain("data-[size=sm]")
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
    expect(source).toMatch(/data-disabled:cursor-not-allowed/)
    expect(source).toMatch(/data-disabled:opacity-50/)
  })

  it("the Switch wrapper uses Base UI switch parts", async () => {
    const source = await read("components/ui/switch.tsx")
    expect(source).toMatch(/@base-ui\/react\/switch/)
    expect(source).toMatch(/SwitchPrimitive\.Root/)
    expect(source).toMatch(/SwitchPrimitive\.Thumb/)
    expect(source).not.toMatch(/radix-ui|@radix-ui/)
  })

  it("label styles support Base UI data-disabled peers", async () => {
    const source = await read("components/ui/label.tsx")
    expect(source).toMatch(/peer-data-disabled:cursor-not-allowed/)
    expect(source).toMatch(/peer-data-disabled:opacity-50/)
  })

  it("admin shell uses the inset surface and compact sticky header", async () => {
    const source = await read("app/admin/layout.tsx")
    expect(source).toMatch(/<SidebarInset[^>]*className="[^"]*bg-muted\/20/)
    expect(source).toMatch(/<SidebarInset[^>]*className="[^"]*md:rounded-xl/)
    expect(source).toMatch(/<header[^>]*className="[^"]*sticky[^\"]*h-14/)
    expect(source).toMatch(/className="[^"]*md:p-6/)
  })

  it("keeps navigation actions as semantic links", async () => {
    const [admin, handoff] = await Promise.all([
      read("app/admin/page.tsx"),
      read("app/admin/handoff/page.tsx"),
    ])

    expect(admin).toMatch(
      /<Link\s+href="\/admin\/handoff"[\s\S]*buttonVariants\(/
    )
    expect(handoff).toMatch(
      /<Link\s+href=\{`\/admin\/sessions\?key=/
    )
    expect(handoff).toMatch(
      /buttonVariants\(\{ variant: "ghost", size: "sm" \}\)/
    )
    expect(admin).not.toMatch(/nativeButton=\{false\}/)
    expect(handoff).not.toMatch(/nativeButton=\{false\}/)
  })
})
