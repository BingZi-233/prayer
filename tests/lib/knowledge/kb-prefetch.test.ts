import { describe, it, expect, vi } from "vitest"
import {
  makeKbPrefetch,
  formatKbBlock,
  InjectedChunkMemo,
} from "@/lib/knowledge/kb-prefetch"
import type { KbHit } from "@/lib/core/db/repo"

const hit = (id: number, content: string, distance: number): KbHit => ({
  id,
  content,
  source: "docs/kb/faq.md",
  distance,
})

/** 造一个可控 repo/embed 的 prefetch;hits 为 searchKb 的返回 */
function setup(hits: KbHit[], over: Record<string, unknown> = {}) {
  const embed = vi.fn(async () => new Float32Array([1, 0, 0]))
  const searchKb = vi.fn(() => hits)
  const prefetch = makeKbPrefetch({
    repo: { searchKb } as never,
    embed,
    ...over,
  })
  return { prefetch, embed, searchKb }
}

describe("formatKbBlock", () => {
  it("按去重后的顺序从 [1] 起重排编号", () => {
    const s = formatKbBlock([{ content: "甲" }, { content: "乙" }])
    expect(s).toContain("[1] 甲")
    expect(s).toContain("[2] 乙")
    expect(s).toContain("知识库检索结果")
    expect(s).toContain("候选片段")
    expect(s).toContain("kb_search")
    expect(s).toContain("packy")
    expect(s).not.toContain("直接据此作答")
  })

  it("空片段 → 空串", () => {
    expect(formatKbBlock([])).toBe("")
  })
})

describe("makeKbPrefetch", () => {
  it("命中 → 拼出带编号的注入块", async () => {
    const { prefetch } = setup([hit(1, "怎么注册", 0.3)])
    const out = await prefetch("怎么注册账号", "qq:1:2")
    expect(out).toContain("[1] 怎么注册")
    expect(out.startsWith("【知识库检索结果")).toBe(true)
  })

  it("超过 maxDistance 的片段被过滤掉", async () => {
    const { prefetch } = setup([hit(1, "近的", 0.3), hit(2, "远的", 1.2)])
    const out = await prefetch("怎么注册账号", "qq:1:2")
    expect(out).toContain("近的")
    expect(out).not.toContain("远的")
  })

  it("全部超阈 → 空串(不是空块)", async () => {
    const { prefetch } = setup([hit(1, "远的", 1.5)])
    expect(await prefetch("怎么注册账号", "qq:1:2")).toBe("")
  })

  it("同 sessionKey 二次同 query → 不重复注入", async () => {
    const { prefetch } = setup([hit(1, "怎么注册", 0.3)])
    expect(await prefetch("怎么注册账号", "s1")).toContain("[1]")
    expect(await prefetch("怎么注册账号", "s1")).toBe("")
  })

  it("只有部分片段是新的时,编号仍从 [1] 起", async () => {
    const hits = [hit(1, "旧片段", 0.3)]
    const embed = vi.fn(async () => new Float32Array([1, 0, 0]))
    const searchKb = vi.fn(() => hits)
    const prefetch = makeKbPrefetch({ repo: { searchKb } as never, embed })
    await prefetch("怎么注册账号", "s1")
    hits.push(hit(2, "新片段", 0.4))
    const out = await prefetch("怎么注册账号", "s1")
    expect(out).toContain("[1] 新片段")
    expect(out).not.toContain("旧片段")
  })

  it("不同 sessionKey 互不影响", async () => {
    const { prefetch } = setup([hit(1, "怎么注册", 0.3)])
    expect(await prefetch("怎么注册账号", "s1")).toContain("[1]")
    expect(await prefetch("怎么注册账号", "s2")).toContain("[1]")
  })

  it("fresh:true 清空本会话记忆,重新注入", async () => {
    const { prefetch } = setup([hit(1, "怎么注册", 0.3)])
    await prefetch("怎么注册账号", "s1")
    expect(await prefetch("怎么注册账号", "s1", { fresh: true })).toContain(
      "[1]"
    )
  })

  it("TTL 过期后重新注入", async () => {
    let t = 1_000
    const { prefetch } = setup([hit(1, "怎么注册", 0.3)], {
      memoTtlMs: 1000,
      now: () => t,
    })
    expect(await prefetch("怎么注册账号", "s1")).toContain("[1]")
    t += 2000
    expect(await prefetch("怎么注册账号", "s1")).toContain("[1]")
  })

  it("片段超 maxCharsPerHit → 截断", async () => {
    const { prefetch } = setup([hit(1, "长".repeat(100), 0.3)], {
      maxCharsPerHit: 10,
    })
    const out = await prefetch("怎么注册账号", "s1")
    expect(out).toContain(`[1] ${"长".repeat(10)}\n`)
  })

  it("片段过 sanitizeForModel(防 MiniMax new_sensitive)", async () => {
    const { prefetch } = setup([hit(1, "需要翻墙才能访问", 0.3)])
    const out = await prefetch("怎么注册账号", "s1")
    expect(out).toContain("[网络]")
    expect(out).not.toContain("翻墙")
  })

  it("query 过短 → 直接返回空串且不调 embed", async () => {
    const { prefetch, embed } = setup([hit(1, "怎么注册", 0.3)])
    expect(await prefetch("嗯", "s1")).toBe("")
    expect(embed).not.toHaveBeenCalled()
  })

  it("embed 抛错 → fail-open 返回空串", async () => {
    const prefetch = makeKbPrefetch({
      repo: { searchKb: () => [] } as never,
      embed: async () => {
        throw new Error("模型加载失败")
      },
    })
    await expect(prefetch("怎么注册账号", "s1")).resolves.toBe("")
  })

  it("searchKb 抛错 → fail-open 返回空串", async () => {
    const prefetch = makeKbPrefetch({
      repo: {
        searchKb: () => {
          throw new Error("db closed")
        },
      } as never,
      embed: async () => new Float32Array([1, 0, 0]),
    })
    await expect(prefetch("怎么注册账号", "s1")).resolves.toBe("")
  })

  it("embed 挂起 → 超时后返回空串", async () => {
    const prefetch = makeKbPrefetch({
      repo: { searchKb: () => [] } as never,
      embed: () => new Promise<Float32Array>(() => {}),
      timeoutMs: 20,
    })
    await expect(prefetch("怎么注册账号", "s1")).resolves.toBe("")
  })

  it("searchKb 拿到配置的 topK", async () => {
    const { prefetch, searchKb } = setup([hit(1, "怎么注册", 0.3)], { topK: 3 })
    await prefetch("怎么注册账号", "s1")
    expect(searchKb).toHaveBeenCalledWith(expect.anything(), 3)
  })
})

describe("InjectedChunkMemo", () => {
  it("超过会话数上限时淘汰最久未用的", () => {
    const memo = new InjectedChunkMemo({ maxSessions: 2 })
    memo.filterAndMark("a", [{ id: 1 }])
    memo.filterAndMark("b", [{ id: 1 }])
    memo.filterAndMark("c", [{ id: 1 }])
    expect(memo.size()).toBe(2)
    // a 被淘汰 → 同一片段可再次注入
    expect(memo.filterAndMark("a", [{ id: 1 }])).toHaveLength(1)
  })

  it("单会话 id 数超上限 → 整体清空,允许重复注入", () => {
    const memo = new InjectedChunkMemo({ maxIds: 2 })
    memo.filterAndMark("s1", [{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(memo.filterAndMark("s1", [{ id: 1 }])).toHaveLength(1)
  })

  it("forget 后同一片段可再次注入", () => {
    const memo = new InjectedChunkMemo()
    memo.filterAndMark("s1", [{ id: 1 }])
    expect(memo.filterAndMark("s1", [{ id: 1 }])).toHaveLength(0)
    memo.forget("s1")
    expect(memo.filterAndMark("s1", [{ id: 1 }])).toHaveLength(1)
  })
})
