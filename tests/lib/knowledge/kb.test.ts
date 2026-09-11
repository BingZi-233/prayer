import { describe, it, expect, beforeEach } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { bus } from "@/lib/core/bus"
import { KB_TOOL_DESC, runKbSearch } from "@/lib/knowledge/kb"

let repo: Repo

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:", 3))
})

describe("KB_TOOL_DESC", () => {
  it("政策文档要查 kb_search,实时价格改走 packy", () => {
    expect(KB_TOOL_DESC).toContain("必须调用")
    expect(KB_TOOL_DESC).toContain("改调 packy")
    expect(KB_TOOL_DESC).not.toContain("回答任何产品、业务、接入配置、故障排查等事实性问题前必须先调用")
  })
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
