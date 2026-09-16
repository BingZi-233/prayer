import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { MAX_MERGE_CHUNKS } from "@/lib/knowledge/reflection/promote-compose"
import {
  promoteEntry,
  runPromote,
  selectPromoteIds,
  registerReflectionPromoter,
  PROMOTE_OUTPUT_SCHEMA,
} from "@/lib/knowledge/reflection/promoter"
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

/** 定时升格的成文阶段桩:返回一件结构完整的 ComposedPromotion。 */
const composeStub = vi.fn(async ({ entry }: { entry: { id: number } }) => ({
  ok: true as const,
  value: {
    doc: "retrieval/faq/api-errors.md",
    kind: "merge" as const,
    content:
      "# 产品：Packy；协议：任一；任务：示例\n示例正文。来源：QQ 群客服会话反思 #" +
      entry.id +
      "；核验日期：2026-09-16；动态性：长期稳定\n",
    sourceStatus: `QQ 群客服会话反思 #${entry.id}`,
    volatility: "长期稳定",
  },
}))

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:", 3))
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
      composeFn: composeStub as never,
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
      file: `retrieval/faq/reflection-${chunkId}.md`,
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
      composeFn: composeStub as never,
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
      file: `retrieval/faq/reflection-${chunkId}.md`,
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
      composeFn: composeStub as never,
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
    expect(r.failed).toBe(true)
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
      composeFn: composeStub as never,
      promoteFn: async ({ chunkId }) => {
        called.push(chunkId)
        return { ok: true as const, file: "f", content: "c" }
      },
    })
    expect(called).toEqual([ok])
  })

  it("单条抛错不击穿整轮:后续条目仍尝试,且不谎报 promoted", async () => {
    const ids = seedApproved(3)
    const promoteFn = vi.fn(async () => ({
      ok: true as const,
      file: "retrieval/faq/api-errors.md",
      content: "c",
    }))
    let call = 0
    const composeFn = vi.fn(async () => {
      call++
      if (call === 1) throw new Error("超时(180000ms)")
      return {
        ok: true as const,
        value: {
          doc: "retrieval/faq/api-errors.md",
          kind: "new" as const,
          content:
            "# 产品：P；协议：任一；任务：T\n正文。来源：QQ 群客服会话反思 #1；核验日期：2026-09-16；动态性：长期稳定\n",
          sourceStatus: "QQ 群客服会话反思 #1",
          volatility: "长期稳定",
        },
      }
    })
    const r = await runPromote({
      repo,
      adminSurface: null,
      embed,
      queryFn: fakeQuery({
        decisions: ids.map((id) => ({ id, promote: true, reason: "yes" })),
      }) as never,
      minEntries: 1,
      maxPerRun: 3,
      notifyAdmin: false,
      composeFn: composeFn as never,
      promoteFn: promoteFn as never,
    })
    // 第 1 条抛错后,第 2、3 条仍被尝试
    expect(composeFn).toHaveBeenCalledTimes(3)
    // 实际升格了 2 条,不能回 0
    expect(r.promoted).toBe(2)
    expect(r.failed).toBe(true)
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
        composeFn: composeStub as never,
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

describe("promoteEntry", () => {
  it("已驳回 直接短路,不调成文", async () => {
    const id = seedApproved(1)[0]!
    repo.setReflectionStatus(id, "rejected")
    const composeFn = vi.fn()
    const r = await promoteEntry({
      repo,
      chunkId: id,
      embed,
      composeFn: composeFn as never,
    })
    expect(r).toEqual({ ok: false, reason: "已驳回,不可升格" })
    expect(composeFn).not.toHaveBeenCalled()
  })

  it("已升格 直接短路:file 留空(无从得知当初落到哪个文档)", async () => {
    const id = seedApproved(1)[0]!
    repo.setReflectionStatus(id, "promoted")
    const composeFn = vi.fn()
    const r = await promoteEntry({
      repo,
      chunkId: id,
      embed,
      composeFn: composeFn as never,
    })
    expect(r).toEqual({
      ok: true,
      file: "",
      content: expect.any(String),
      already: true,
    })
    expect(composeFn).not.toHaveBeenCalled()
  })

  it("成文失败 → 该条不升格,状态仍 approved", async () => {
    const id = seedApproved(1)[0]!
    const r = await promoteEntry({
      repo,
      chunkId: id,
      embed,
      composeFn: (async () => ({
        ok: false as const,
        reason: "无法解析成文结果",
      })) as never,
      promoteFn: vi.fn() as never,
    })
    expect(r).toEqual({ ok: false, reason: "无法解析成文结果" })
    expect(repo.reflectionEntryDetail(id)?.status).toBe("approved")
    expect(repo.countReflectionEntries()).toBe(1)
  })

  it("成文抛错(超时/流错误)原样上抛,不被吞掉", async () => {
    const id = seedApproved(1)[0]!
    // composePromotion 的失败契约:校验类失败返回 ok:false,I/O 与超时类失败是
    // 抛出且它自己不 catch。promoteEntry 必须同样不吞——定时路径靠 runPromote 的
    // try/catch 兜底(emitErrorSafely + 标 failed),手动路径靠路由的外层 catch。
    // 吞掉会让超时既不进错误总线、也不告诉调用方本轮为什么没升格。
    await expect(
      promoteEntry({
        repo,
        chunkId: id,
        embed,
        composeFn: (async () => {
          throw new Error("超时(180000ms)")
        }) as never,
      })
    ).rejects.toThrow("超时(180000ms)")
  })

  it("只把 retrieval/ 前缀且未超段的文档交给成文", async () => {
    // 候选池必须足够大,否则 KNN 只返回最近几条,被过滤的文档根本没进 hits,
    // 断言就成了"没看见就等于过滤了"的假通过。所以先验证它们确实在 hits 里。
    const CANDS = 60
    repo.insertKbEntry(
      "retrieval/faq/api-errors.md",
      "主题：API 401/403/404",
      "retrieval/faq/api-errors.md",
      vec()
    )
    // 同一文档的第二个 chunk:它也会各自命中 hits,去重必须收敛成一条候选
    repo.insertKbEntry(
      "retrieval/faq/api-errors.md",
      "主题：API 401/403/404(续)",
      "retrieval/faq/api-errors.md",
      vec()
    )
    repo.insertKbEntry(
      "promoted/reflection-9.md",
      "历史层文档",
      "promoted/reflection-9.md",
      vec()
    )
    for (let i = 0; i < MAX_MERGE_CHUNKS + 1; i++)
      repo.insertKbEntry(
        "retrieval/legal/terms.md",
        `大文档段${i}`,
        "retrieval/legal/terms.md",
        vec()
      )
    const id = seedApproved(1)[0]!

    let seen: string[] = []
    await promoteEntry({
      repo,
      chunkId: id,
      embed,
      candidateK: CANDS,
      composeFn: (async (deps: { candidateDocs: { doc: string }[] }) => {
        seen = deps.candidateDocs.map((d) => d.doc)
        return { ok: false as const, reason: "只看候选" }
      }) as never,
    })

    // 前置条件:两类被过滤的文档确实进了 hits
    const hits = repo.searchBaseKb(vec(), CANDS)
    expect(hits.some((h) => h.doc === "promoted/reflection-9.md")).toBe(true)
    expect(hits.some((h) => h.doc === "retrieval/legal/terms.md")).toBe(true)

    expect(seen).toContain("retrieval/faq/api-errors.md")
    // 该文档命中两次,候选里仍只出现一次
    expect(
      seen.filter((d) => d === "retrieval/faq/api-errors.md")
    ).toHaveLength(1)
    expect(seen.some((d) => d.startsWith("promoted/"))).toBe(false)
    expect(seen.some((d) => d.includes("legal/terms"))).toBe(false)
  })

  it("promoteEntry 内部不重复 embed 反思正文", async () => {
    const id = seedApproved(1)[0]!
    const embedSpy = vi.fn(async () => vec())
    await promoteEntry({
      repo,
      chunkId: id,
      embed: embedSpy,
      composeFn: (async () => ({ ok: false as const, reason: "x" })) as never,
    })
    expect(embedSpy).toHaveBeenCalledTimes(1)
  })

  it("runPromote 复用同一轮的 embed 结果", async () => {
    const id = seedApproved(1)[0]!
    const embedSpy = vi.fn(async () => vec())
    const composeFn = vi.fn(async () => ({
      ok: true as const,
      value: {
        doc: "retrieval/faq/api-errors.md",
        kind: "new" as const,
        content:
          "# 产品：P；协议：任一；任务：T\n正文。来源：QQ 群客服会话反思 #" +
          id +
          "；核验日期：2026-09-16；动态性：长期稳定\n",
        sourceStatus: `QQ 群客服会话反思 #${id}`,
        volatility: "长期稳定",
      },
    }))
    await runPromote({
      repo,
      adminSurface: null,
      embed: embedSpy,
      queryFn: fakeQuery({
        decisions: [{ id, promote: true, reason: "yes" }],
      }) as never,
      minEntries: 1,
      maxPerRun: 5,
      notifyAdmin: false,
      composeFn: composeFn as never,
      promoteFn: (async () => ({
        ok: true as const,
        file: "retrieval/faq/api-errors.md",
        content: "c",
      })) as never,
    })
    // 第一阶段取候选上下文时 embed 一次;第二阶段成文复用同一结果,不应再算一遍
    expect(embedSpy).toHaveBeenCalledTimes(1)
  })
})
