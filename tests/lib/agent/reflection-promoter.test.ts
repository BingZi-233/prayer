import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import {
  applyPromote,
  promotedDocRel,
  promotedMarkdown,
} from "@/lib/reflect-promote"
import {
  runPromote,
  selectPromoteIds,
  registerReflectionPromoter,
  PROMOTE_OUTPUT_SCHEMA,
} from "@/lib/agent/reflection-promoter"
import { bus } from "@/lib/core/bus"
import type { ActionSend, ErrorOccurred } from "@/lib/core/chat/events"

let repo: Repo
const vec = () => new Float32Array([1, 0, 0])
const embed = async () => vec()

function seedApproved(n: number) {
  const ids: number[] = []
  for (let i = 0; i < n; i++) {
    const id = repo.insertKbEntry(
      "human-reflection",
      `通用FAQ${i}:完整可复用步骤`,
      `human-reflection:100:${i}`,
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "100", `问${i}`, `答${i}`)
    ids.push(id)
  }
  return ids
}

function fakeQuery(structured: unknown) {
  return () =>
    (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "" }] },
      }
      yield {
        type: "result",
        subtype: "success",
        structured_output: structured,
      }
    })()
}

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:", 3))
})

describe("reflect-promote helpers", () => {
  it("promotedDocRel / promotedMarkdown 格式稳定", () => {
    expect(promotedDocRel(42)).toBe("promoted/reflection-42.md")
    expect(promotedMarkdown(42, "  正文  ")).toBe("# 升格反思 #42\n\n正文\n")
  })

  it("applyPromote:写盘+入库+标 promoted;检索走正式文档", async () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "退款 7 天到账",
      "human-reflection:1:1",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "1", "多久退款", "7天")
    const writes: { path: string; body: string }[] = []
    const r = await applyPromote({
      repo,
      chunkId: id,
      embed,
      writeFileFn: async (p, b) => {
        writes.push({ path: p, body: b })
      },
      mkdirFn: async () => {},
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file).toBe("promoted/reflection-" + id + ".md")
    expect(writes).toHaveLength(1)
    expect(writes[0]!.body).toContain("退款 7 天到账")
    // 原反思 chunk 已物理删除:不再出现在 reflectionEntries,也不在 searchKb
    expect(repo.reflectionEntries().find((e) => e.id === id)).toBeUndefined()
    // 反思侧不再命中;正式文档命中
    const hits = repo.searchKb(vec(), 5)
    expect(hits.some((h) => h.content.includes("退款"))).toBe(true)
    expect(hits.every((h) => h.source !== `human-reflection:1:1` || true)).toBe(
      true
    )
    // promoted 反思本身不进 searchKb
    const reflectionHit = hits.find((h) => h.id === id)
    expect(reflectionHit).toBeUndefined()
    // 正式 doc 在库
    expect(repo.kbChunksByDoc(r.file).length).toBeGreaterThan(0)
  })

  it("applyPromote 幂等:已升格 → 原 chunk 已物理删除,再调返回条目不存在", async () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "faq",
      "human-reflection:1:1",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "1", "q", "a")
    await applyPromote({
      repo,
      chunkId: id,
      embed,
      writeFileFn: async () => {},
      mkdirFn: async () => {},
    })
    // 第二次写盘函数应不被调用(早期 return),且语义变成"条目不存在"
    const r2 = await applyPromote({
      repo,
      chunkId: id,
      embed,
      writeFileFn: async () => {
        throw new Error("should not write")
      },
      mkdirFn: async () => {},
    })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.reason).toBe("条目不存在")
  })

  it("applyPromote 拒绝 rejected", async () => {
    const id = repo.insertKbEntry(
      "human-reflection",
      "坏",
      "human-reflection:1:1",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "1", "q", "a")
    repo.setReflectionStatus(id, "rejected")
    const r = await applyPromote({
      repo,
      chunkId: id,
      embed,
      writeFileFn: async () => {},
      mkdirFn: async () => {},
    })
    expect(r.ok).toBe(false)
  })
})

describe("selectPromoteIds", () => {
  it("只取候选内 promote=true,截断 maxPerRun,忽略编造 id", () => {
    const r = selectPromoteIds(
      [
        { id: 1, promote: true, reason: "a" },
        { id: 99, promote: true, reason: "fake" },
        { id: 2, promote: false, reason: "no" },
        { id: 3, promote: true, reason: "b" },
        { id: 4, promote: true, reason: "c" },
      ],
      [1, 2, 3, 4],
      2
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ids).toEqual([1, 3])
  })
  it("null decisions → fail", () => {
    expect(selectPromoteIds(null, [1], 5).ok).toBe(false)
  })
})

describe("runPromote", () => {
  it("少于 minEntries → 不调 LLM", async () => {
    seedApproved(1)
    const qf = vi.fn(fakeQuery({ decisions: [] }))
    const r = await runPromote({
      repo,
      adminSurface: { channel: "qq" as const, chatId: "999" },
      embed,
      queryFn: qf as never,
      minEntries: 3,
      promoteFn: async () => ({ ok: true, file: "x", content: "y" }),
    })
    expect(qf).not.toHaveBeenCalled()
    expect(r).toEqual({ considered: 1, promoted: 0 })
  })

  it("LLM 决策升格 → promoteFn 被调用 + 通知", async () => {
    const ids = seedApproved(3)
    const notice = new Promise<ActionSend>((res) =>
      bus.once("action.send", res)
    )
    const promoteFn = vi.fn(async ({ chunkId }: { chunkId: number }) => ({
      ok: true as const,
      file: `promoted/reflection-${chunkId}.md`,
      content: `通用FAQ content`,
    }))
    let captured: { options?: { outputFormat?: unknown } } | undefined
    const qf = (args: { options?: { outputFormat?: unknown } }) => {
      captured = args
      return fakeQuery({
        decisions: [
          { id: ids[0], promote: true, reason: "通用完整" },
          { id: ids[1], promote: false, reason: "已覆盖" },
          { id: ids[2], promote: true, reason: "有增量" },
        ],
      })()
    }
    const r = await runPromote({
      repo,
      adminSurface: { channel: "qq" as const, chatId: "999" },
      embed,
      queryFn: qf as never,
      minEntries: 1,
      maxPerRun: 5,
      promoteFn: promoteFn as never,
    })
    expect(captured?.options?.outputFormat).toEqual({
      type: "json_schema",
      schema: PROMOTE_OUTPUT_SCHEMA,
    })
    expect(r.promoted).toBe(2)
    expect(promoteFn).toHaveBeenCalledTimes(2)
    const a = await notice
    expect(a.text).toContain("反思自动升格")
  })

  it("maxPerRun 截断", async () => {
    const ids = seedApproved(4)
    const promoteFn = vi.fn(async ({ chunkId }: { chunkId: number }) => ({
      ok: true as const,
      file: `promoted/reflection-${chunkId}.md`,
      content: "x",
    }))
    await runPromote({
      repo,
      adminSurface: { channel: "qq" as const, chatId: "999" },
      embed,
      queryFn: fakeQuery({
        decisions: ids.map((id) => ({ id, promote: true, reason: "yes" })),
      }) as never,
      minEntries: 1,
      maxPerRun: 2,
      notifyAdmin: false,
      promoteFn: promoteFn as never,
    })
    expect(promoteFn).toHaveBeenCalledTimes(2)
  })

  it("非法 structured → 不升格 + emit error", async () => {
    seedApproved(2)
    const err = new Promise<ErrorOccurred>((res) =>
      bus.once("error.occurred", res)
    )
    const promoteFn = vi.fn()
    const r = await runPromote({
      repo,
      adminSurface: { channel: "qq" as const, chatId: "999" },
      embed,
      queryFn: fakeQuery({ nope: true }) as never,
      minEntries: 1,
      promoteFn: promoteFn as never,
    })
    expect(r.promoted).toBe(0)
    expect(promoteFn).not.toHaveBeenCalled()
    expect((await err).scope).toBe("reflection-promote")
  })

  it("跳过 rejected/promoted 候选", async () => {
    const ok = seedApproved(1)[0]!
    const bad = repo.insertKbEntry(
      "human-reflection",
      "坏",
      "human-reflection:1:9",
      vec()
    )
    repo.insertReflectionMeta(bad, "qq", "1", "q", "a")
    repo.setReflectionStatus(bad, "rejected")
    const done = repo.insertKbEntry(
      "human-reflection",
      "已升",
      "human-reflection:1:8",
      vec()
    )
    repo.insertReflectionMeta(done, "qq", "1", "q", "a")
    repo.setReflectionStatus(done, "promoted")
    const called: number[] = []
    await runPromote({
      repo,
      adminSurface: { channel: "qq" as const, chatId: "999" },
      embed,
      queryFn: fakeQuery({
        decisions: [
          { id: ok, promote: true, reason: "yes" },
          { id: bad, promote: true, reason: "should ignore if not candidate" },
          { id: done, promote: true, reason: "should ignore" },
        ],
      }) as never,
      minEntries: 1,
      notifyAdmin: false,
      promoteFn: async ({ chunkId }) => {
        called.push(chunkId)
        return { ok: true as const, file: "f", content: "c" }
      },
    })
    expect(called).toEqual([ok])
  })
})

describe("registerReflectionPromoter", () => {
  it("到期跑一次并推进游标", async () => {
    vi.useFakeTimers()
    try {
      seedApproved(2)
      const qf = vi.fn(
        fakeQuery({
          decisions: [],
        })
      )
      // 空 decisions → 0 promote,但会调 LLM
      const stop = registerReflectionPromoter({
        repo,
        adminSurface: { channel: "qq" as const, chatId: "999" },
        embed,
        now: () => 7_000_000,
        promoteMs: 1000,
        scanMs: 1000,
        firstDelayMs: 10,
        minEntries: 1,
        queryFn: qf as never,
        notifyAdmin: false,
        promoteFn: async () => ({ ok: true, file: "f", content: "c" }),
      })
      repo.setPromoteAt(7_000_000 - 5000)
      await vi.advanceTimersByTimeAsync(10)
      expect(qf).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(repo.promoteAt()).toBe(7_000_000)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
