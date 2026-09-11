import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFile(file, "utf8")

describe("admin knowledge page contracts", () => {
  it("renders the ranking and reflection tables on the shared table shell", async () => {
    const [ranking, reflection] = await Promise.all([
      read("app/admin/ranking/page.tsx"),
      read("app/admin/reflection/page.tsx"),
    ])

    expect(ranking).toContain("<TableShell")
    expect(ranking).toContain("@/components/admin/table-shell")
    expect(reflection).toContain("<TableShell")
    expect(reflection).toContain("@/components/admin/table-shell")
  })

  it("uses the shared search input group on the knowledge file list", async () => {
    const source = await read("app/admin/kb/page.tsx")

    expect(source).toContain("InputGroupInput")
    expect(source).toContain('aria-label="搜索路径"')
  })

  it("preserves the knowledge base save and ingest flow", async () => {
    const source = await read("app/admin/kb/page.tsx")

    expect(source).toContain("saveAndIngest")
    expect(source).toContain('"/api/kb/ingest"')
    expect(source).toContain("待重建索引")
    expect(source).toContain("<MasterDetail")
    expect(source).toContain('backLabel="返回文件列表"')
  })

  it("preserves reflection moderation and promotion semantics", async () => {
    const [page, hook] = await Promise.all([
      read("app/admin/reflection/page.tsx"),
      read("components/admin/reflection/use-reflection-actions.ts"),
    ])
    // 三个动作搬进了 hook,页面只做编排 —— 断言同时读两者:守的是
    // 「这套动作的语义仍在」,不是「必须写在某个文件里」。
    const source = `${page}\n${hook}`

    expect(source).toContain('action: "approve" | "reject" | "promote"')
    expect(source).toContain('"/api/reflection/compact"')
    expect(source).toContain('"/api/reflection/promote"')
    expect(source).toContain('method: "PATCH"')
  })

  it("keeps the ranking window switch wired to the polling url", async () => {
    const source = await read("app/admin/ranking/page.tsx")

    expect(source).toContain("/api/ranking?window=")
    expect(source).toContain("WINDOWS.map")
  })
})
