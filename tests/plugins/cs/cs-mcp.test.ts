import { describe, expect, it } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { KB_SEARCH_SQL } from "@/lib/tools/kb"

// cs 插件子进程的 kb_search 用 KB_SEARCH_SQL 直接查库(kb.ts 唯一事实源)。
// 本组验证:插件路径与 repo.searchKb 行为一致——驳回/升格条目不外漏。
const vec = () => new Float32Array([1, 0, 0])

function rowsFor(db: ReturnType<typeof openDb>, k = 10) {
  const stmt = db.prepare(KB_SEARCH_SQL)
  return (q: Float32Array) =>
    stmt.all(Buffer.from(q.buffer), k) as {
      id: number
      content: string
      distance: number
    }[]
}

describe("cs-mcp KB_SEARCH_SQL(插件路径检索过滤)", () => {
  it("与 repo.searchKb 同源:rejected/promoted 条目不出现,approved 命中", () => {
    const db = openDb(":memory:", 3)
    const repo = new Repo(db)

    const base = repo.insertKbEntry("faq/x.md", "基础文档", "faq/x.md", vec())
    const ok = repo.insertKbEntry(
      "human-reflection",
      "已入库反思",
      "human-reflection:qq:1:1",
      vec()
    )
    repo.insertReflectionMeta(ok, "qq", "1", "q", "a")
    const bad = repo.insertKbEntry(
      "human-reflection",
      "已驳回反思",
      "human-reflection:qq:1:2",
      vec()
    )
    repo.insertReflectionMeta(bad, "qq", "1", "q2", "a2")
    repo.setReflectionStatus(bad, "rejected")
    const promo = repo.insertKbEntry(
      "human-reflection",
      "已升格反思",
      "human-reflection:qq:1:3",
      vec()
    )
    repo.insertReflectionMeta(promo, "qq", "1", "q3", "a3")
    repo.setReflectionStatus(promo, "promoted")

    // 插件路径(直接 SQL):过滤生效
    const pluginHits = rowsFor(db)(vec())
    const pluginContents = pluginHits.map((h) => h.content)
    expect(pluginContents).toContain("基础文档")
    expect(pluginContents).toContain("已入库反思")
    expect(pluginContents).not.toContain("已驳回反思")
    expect(pluginContents).not.toContain("已升格反思")

    // repo 路径:与插件路径逐行一致(同一常量,防再漂移)
    const repoHits = repo.searchKb(vec(), 10)
    expect(pluginHits.map((h) => h.id)).toEqual(repoHits.map((h) => h.id))
    expect(base).toBeGreaterThan(0)
    db.close()
  })
})
