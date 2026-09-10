import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const pageFiles = [
  "app/admin/page.tsx",
  "app/admin/logs/page.tsx",
  "app/admin/sessions/page.tsx",
  "app/admin/handoff/page.tsx",
  "app/admin/proactive/page.tsx",
  "app/admin/kb/page.tsx",
  "app/admin/reflection/page.tsx",
  "app/admin/ranking/page.tsx",
  "app/admin/config/page.tsx",
  "app/admin/groups/page.tsx",
  "app/admin/capabilities/page.tsx",
  "app/admin/plugins/page.tsx",
]

describe("admin visual contracts", () => {
  it("uses flex gap utilities instead of deprecated space utilities", async () => {
    const sources = await Promise.all(
      pageFiles.map((file) => readFile(file, "utf8"))
    )
    expect(sources.join("\n")).not.toMatch(/space-[xy]-/)
  })

  it("keeps admin pages on semantic theme colors", async () => {
    const sources = await Promise.all(
      pageFiles.map((file) => readFile(file, "utf8"))
    )
    expect(sources.join("\n")).not.toMatch(
      /(?:bg|text|border)-(?:amber|blue|emerald|green|orange|red|slate|zinc|gray)-/
    )
  })

  // Base UI 的 Select 只有在 Root 上给 items(值→标签)时,触发器才渲染中文标签,
  // 否则直接显示原始值(off / inherit / github)。逐个用例守着。
  it("gives every Select an items map so triggers show labels", async () => {
    const files = [...pageFiles, "components/admin/config/admin-settings.tsx"]
    const sources = await Promise.all(
      files.map((file) => readFile(file, "utf8"))
    )
    for (const [i, source] of sources.entries()) {
      const tags =
        source.match(
          /<Select\b(?!Item|Trigger|Content|Value|Group|Label|Separator)[^>]*>/g
        ) ?? []
      for (const tag of tags) {
        expect(tag, `${files[i]} 的 Select 缺少 items`).toContain("items=")
      }
    }
  })
})

describe("settings page controls", () => {
  it("uses the searchable picker for long option lists", async () => {
    const source = await readFile(
      "components/admin/config/admin-settings.tsx",
      "utf8"
    )
    // 管理群 / 管理 Chat 的候选很多,必须是可搜索下拉而不是 Select
    expect(source.match(/<SearchSelect/g)?.length).toBe(2)
    expect(source).toContain('searchPlaceholder="搜索群名 / 群号…"')
  })

  it("keeps the search input inside the shared picker", async () => {
    const source = await readFile("components/admin/search-select.tsx", "utf8")
    expect(source).toContain("CommandInput")
    expect(source).toContain("PopoverContent")
  })

  it("gives the log list a sticky column header", async () => {
    const source = await readFile("app/admin/logs/page.tsx", "utf8")
    expect(source).toContain("时间")
    expect(source).toContain("级别")
    expect(source).toContain("来源")
  })
})
