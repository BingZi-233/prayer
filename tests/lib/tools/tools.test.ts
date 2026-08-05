import { describe, it, expect, beforeEach } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { bus } from "@/lib/bus"
import { runKbSearch } from "@/lib/tools/kb"

let repo: Repo

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:", 3))
})

describe("runKbSearch", () => {
  it("检索命中片段文本", async () => {
    const fakeEmbed = async () => new Float32Array([1, 0, 0])
    const id = repo.insertKbChunk("faq.md", "退货 7 天内", "faq")
    repo.insertKbVec(id, new Float32Array([1, 0, 0]))
    const text = await runKbSearch(repo, fakeEmbed, "退货")
    expect(text).toContain("退货 7 天内")
  })

  it("无命中返回占位文案", async () => {
    const fakeEmbed = async () => new Float32Array([0, 1, 0])
    const text = await runKbSearch(repo, fakeEmbed, "无关")
    expect(text).toBe("知识库无相关内容。")
  })
})
