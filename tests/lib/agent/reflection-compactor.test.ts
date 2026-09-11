import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { bus } from "@/lib/core/bus"
import {
  runCompact,
  validateCompacted,
  validateCompactedDetailed,
  partitionBatches,
  COMPACT_OUTPUT_SCHEMA,
  COMPLETE_MIN_RATIO,
  DEFAULT_COMPACT_BATCH_SIZE,
  DEFAULT_COMPACT_MS,
} from "@/lib/agent/reflection-compactor"
import type { ActionSend, ErrorOccurred } from "@/lib/events"

let repo: Repo
const vec = () => new Float32Array([1, 0, 0])
const embed = async () => vec()

// 假 query:只返回 structured_output(SDK 强制路径;不再走文本 JSON)
function fakeQuery(structured?: unknown) {
  return () =>
    (async function* () {
      yield {
        type: "result",
        subtype: "success",
        ...(structured !== undefined ? { structured_output: structured } : {}),
      }
    })()
}

function seedReflections(n: number) {
  for (let i = 0; i < n; i++) {
    repo.insertKbEntry(
      "human-reflection",
      `反思${i}`,
      `human-reflection:100:${i}`,
      vec()
    )
  }
}

function faqsItems(n: number, prefix = "合并") {
  return {
    items: Array.from({ length: n }, (_, i) => ({ faq: `${prefix}${i}` })),
  }
}

const opts = (over: Record<string, unknown> = {}) => ({
  repo,
  adminSurface: { channel: "qq" as const, chatId: "999" },
  embed,
  now: () => 7_000_000,
  minEntries: 3,
  ...over,
})

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:", 3))
})

describe("partitionBatches", () => {
  it("按 batchSize 顺序切分", () => {
    expect(partitionBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it("batchSize ≥ 长度 → 单批", () => {
    expect(partitionBatches([1, 2, 3], 30)).toEqual([[1, 2, 3]])
  })
  it("空数组 → 空", () => {
    expect(partitionBatches([], 10)).toEqual([])
  })
})

describe("runCompact", () => {
  it("少于 minEntries → 跳过,不调 LLM,库不变", async () => {
    seedReflections(2)
    const qf = vi.fn(fakeQuery({ items: [] }))
    await runCompact(opts({ queryFn: qf as never, minEntries: 3 }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.reflectionEntries()).toHaveLength(2)
  })

  it("正常整理 → 库被替换为新集 + 通知管理群 + gid 为 0", async () => {
    seedReflections(5)
    const notice = new Promise<ActionSend>((res) =>
      bus.once("action.send", res)
    )
    // 5 条 → 3 条(≥ 40% 下限),模拟近义合并
    await runCompact(opts({ queryFn: fakeQuery(faqsItems(3)) as never }))
    const a = await notice
    expect(a.channel).toBe("qq")
    expect(a.chatId).toBe("999")
    expect(a.text).toContain("5 → 3")
    const refs = repo.reflectionEntries()
    expect(refs).toHaveLength(3)
    expect(refs.map((r) => r.content).sort()).toEqual([
      "合并0",
      "合并1",
      "合并2",
    ])
    expect(
      refs.every(
        (r) => r.chatId === "0" && r.channel === "qq" && r.ts === 7_000_000
      )
    ).toBe(true)
  })

  it("query 带 outputFormat.json_schema + 用 structured_output", async () => {
    seedReflections(5)
    let captured: { options?: { outputFormat?: unknown } } | undefined
    const qf = (args: { options?: { outputFormat?: unknown } }) => {
      captured = args
      return fakeQuery(faqsItems(3, "结构化"))()
    }
    await runCompact(opts({ queryFn: qf as never }))
    expect(captured?.options?.outputFormat).toEqual({
      type: "json_schema",
      schema: COMPACT_OUTPUT_SCHEMA,
    })
    expect(
      repo
        .reflectionEntries()
        .map((r) => r.content)
        .sort()
    ).toEqual(["结构化0", "结构化1", "结构化2"])
  })

  it("notifyAdmin=false → 整理成功但不通知管理群", async () => {
    seedReflections(5)
    const spy = vi.fn()
    bus.on("action.send", spy)
    await runCompact(
      opts({
        notifyAdmin: false,
        queryFn: fakeQuery(faqsItems(3)) as never,
      })
    )
    expect(spy).not.toHaveBeenCalled()
    expect(repo.reflectionEntries()).toHaveLength(3)
  })

  it("整理成功 → 写入 reflect_compactions 记录(before/after 快照)", async () => {
    seedReflections(5)
    await runCompact(
      opts({ queryFn: fakeQuery(faqsItems(3, "合并")) as never })
    )
    const recs = repo.recentCompactions(10)
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({
      ts: 7_000_000,
      beforeCount: 5,
      afterCount: 3,
    })
    expect(recs[0].before.sort()).toEqual([
      "反思0",
      "反思1",
      "反思2",
      "反思3",
      "反思4",
    ])
    expect(recs[0].after.sort()).toEqual(["合并0", "合并1", "合并2"])
  })

  it("整理失败(空集)→ 不写整理记录", async () => {
    seedReflections(5)
    bus.on("error.occurred", () => {})
    await runCompact(opts({ queryFn: fakeQuery({ items: [] }) as never }))
    expect(repo.recentCompactions(10)).toHaveLength(0)
  })

  it("安全底线:空 items → 保留旧库 + emit error,不替换", async () => {
    seedReflections(5)
    const err = new Promise<ErrorOccurred>((res) =>
      bus.once("error.occurred", res)
    )
    const spy = vi.fn()
    bus.on("action.send", spy)
    await runCompact(opts({ queryFn: fakeQuery({ items: [] }) as never }))
    expect((await err).scope).toBe("reflection-compact")
    expect(repo.reflectionEntries()).toHaveLength(5)
    expect(spy).not.toHaveBeenCalled()
  })

  it("安全底线:无 structured_output → 保留旧库", async () => {
    seedReflections(5)
    const err = new Promise<ErrorOccurred>((res) =>
      bus.once("error.occurred", res)
    )
    const spy = vi.fn()
    bus.on("action.send", spy)
    await runCompact(opts({ queryFn: fakeQuery(undefined) as never }))
    expect((await err).scope).toBe("reflection-compact")
    expect(repo.reflectionEntries()).toHaveLength(5)
    expect(spy).not.toHaveBeenCalled()
  })

  it("安全底线:条目暴涨(> 输入 ×1.5)→ 保留旧库", async () => {
    seedReflections(4)
    const big = {
      items: Array.from({ length: 7 }, (_, i) => ({ faq: `x${i}` })),
    }
    const err = new Promise<ErrorOccurred>((res) =>
      bus.once("error.occurred", res)
    )
    const spy = vi.fn()
    bus.on("action.send", spy)
    await runCompact(opts({ queryFn: fakeQuery(big) as never }))
    expect((await err).scope).toBe("reflection-compact")
    expect(repo.reflectionEntries()).toHaveLength(4)
    expect(spy).not.toHaveBeenCalled()
  })

  it("安全底线:完整产出低于 COMPLETE_MIN_RATIO → 保留旧库", async () => {
    seedReflections(10)
    // 10 → 2 远低于 40% 下限(floor=4)
    const err = new Promise<ErrorOccurred>((res) =>
      bus.once("error.occurred", res)
    )
    await runCompact(opts({ queryFn: fakeQuery(faqsItems(2)) as never }))
    const e = (await err).err as Error
    expect(e.message).toMatch(/过度删除|下限/)
    expect(repo.reflectionEntries()).toHaveLength(10)
  })

  it("允许更激进合并:10 → 4(=40% 下限)通过", async () => {
    seedReflections(10)
    await runCompact(
      opts({ queryFn: fakeQuery(faqsItems(4, "激进")) as never })
    )
    expect(repo.reflectionEntries()).toHaveLength(4)
  })

  it("基础上下文:去重后的基础片段注入 prompt(同一 chunk 只出现一次)", async () => {
    seedReflections(3) // 3 条反思,同一向量都最近邻到同一基础 chunk
    repo.insertKbEntry("faq/x.md", "基础片段X", "faq/x.md", vec())
    let captured = ""
    const qf = (args: { prompt: string }) => {
      captured = args.prompt
      // 3 条输入 floor=ceil(3*0.4)=2,产出 2 条即可
      return fakeQuery(faqsItems(2, "甲"))()
    }
    await runCompact(opts({ queryFn: qf as never }))
    expect(captured).toContain("<AUTHORITATIVE_DOCS_JSONL>")
    expect(captured).toContain("基础片段X")
    expect(captured.split("基础片段X").length - 1).toBe(1) // 去重:只一次
  })

  it("旁路:context 阶段 embed 抛错 → emit error,不抛不替换", async () => {
    seedReflections(5)
    const err = new Promise<ErrorOccurred>((res) =>
      bus.once("error.occurred", res)
    )
    let n = 0
    const throwingEmbed = async () => {
      if (n++ === 0) throw new Error("embed boom")
      return vec()
    }
    await runCompact(
      opts({
        embed: throwingEmbed as never,
        queryFn: fakeQuery({ items: [] }) as never,
      })
    )
    expect((await err).scope).toBe("reflection-compact")
    expect(repo.reflectionEntries()).toHaveLength(5)
  })

  it("对已压缩集(gid 0)再跑一轮不报错,产出替换成功", async () => {
    // 首轮:5 → 3
    seedReflections(5)
    await runCompact(opts({ queryFn: fakeQuery(faqsItems(3, "甲")) as never }))
    expect(repo.reflectionEntries()).toHaveLength(3)
    // 次轮:3 条(≥ minEntries 3)→ 可再跑;此处 minEntries 抬到 5 跳过
    const qf = vi.fn(fakeQuery(faqsItems(2, "乙")))
    await runCompact(opts({ queryFn: qf as never, minEntries: 5 }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.reflectionEntries()).toHaveLength(3)
  })

  it("分批:超过 batchSize → 多次调 LLM,汇总替换", async () => {
    seedReflections(7)
    const qf = vi.fn((args: { prompt: string }) => {
      // 每批按 prompt 中「共 N 条」缩到约一半(仍 ≥ 40%)
      const m = /共 (\d+) 条/.exec(args.prompt)
      const n = m ? Number(m[1]) : 3
      const out = Math.max(2, Math.ceil(n * 0.5))
      return fakeQuery(faqsItems(out, `批${qf.mock.calls.length}`))()
    })
    const notice = new Promise<ActionSend>((res) =>
      bus.once("action.send", res)
    )
    await runCompact(
      opts({
        batchSize: 3,
        queryFn: qf as never,
      })
    )
    // 7 条 / 3 → 3 批(3+3+1);末批 1 条不调 LLM
    expect(qf).toHaveBeenCalledTimes(2)
    const a = await notice
    expect(a.text).toMatch(/分 3 批/)
    // 批0:3→2, 批1:3→2, 批2:1 原样 → 5
    expect(repo.reflectionEntries()).toHaveLength(5)
    const recs = repo.recentCompactions(1)
    expect(recs[0]).toMatchObject({ beforeCount: 7, afterCount: 5 })
  })

  it("分批:一批评校验失败 → 该批保留原文,其它批仍生效", async () => {
    seedReflections(6)
    bus.on("error.occurred", () => {})
    let call = 0
    const qf = vi.fn(() => {
      call++
      if (call === 1) return fakeQuery({ items: [] })() // 第 1 批失败
      return fakeQuery(faqsItems(2, "乙"))() // 第 2 批 3→2 成功
    })
    await runCompact(
      opts({
        batchSize: 3,
        queryFn: qf as never,
      })
    )
    expect(qf).toHaveBeenCalledTimes(2)
    const contents = repo
      .reflectionEntries()
      .map((r) => r.content)
      .sort()
    // reflectionEntries 按 id DESC:首批 反思5/4/3 失败保留,次批 反思2/1/0 → 乙0/乙1
    expect(contents).toEqual(["乙0", "乙1", "反思3", "反思4", "反思5"])
  })

  it("分批:全部批次失败 → 不替换", async () => {
    seedReflections(6)
    bus.on("error.occurred", () => {})
    const qf = vi.fn(fakeQuery({ items: [] }))
    await runCompact(
      opts({
        batchSize: 3,
        queryFn: qf as never,
      })
    )
    expect(qf).toHaveBeenCalledTimes(2)
    expect(repo.reflectionEntries()).toHaveLength(6)
    expect(repo.recentCompactions(10)).toHaveLength(0)
  })
})

describe("validateCompacted(structured 优先 + 文本兜底)", () => {
  it("正常 → 返回 trim 后非空 faq 列表", () => {
    expect(
      validateCompacted(
        { items: [{ faq: " a " }, { faq: "b" }, { faq: "c" }] },
        3
      )
    ).toEqual(["a", "b", "c"])
  })
  it("无 structured / 非法形状且无文本 → null", () => {
    expect(validateCompacted(undefined, 3)).toBeNull()
    expect(validateCompacted({ faq: "a" }, 3)).toBeNull()
    expect(validateCompacted({ nope: true }, 3)).toBeNull()
  })
  it("文本 JSON 兜底", () => {
    expect(
      validateCompacted(
        undefined,
        3,
        `{"items":[{"faq":"甲"},{"faq":"乙"},{"faq":"丙"}]}`
      )
    ).toEqual(["甲", "乙", "丙"])
  })
  it("空集而输入非空 → null", () => {
    expect(validateCompacted({ items: [] }, 5)).toBeNull()
  })
  it("暴涨 > ×1.5 → null", () => {
    const items = Array.from({ length: 7 }, () => ({ faq: "x" }))
    expect(validateCompacted({ items }, 4)).toBeNull()
  })
  it("过滤空白 faq 后仍有内容 → 返回过滤结果", () => {
    // 1 输入 floor=1;过滤后 1 条
    expect(
      validateCompacted(
        { items: [{ faq: "a" }, { faq: "  " }, { faq: "" }] },
        1
      )
    ).toEqual(["a"])
  })
  it(`低于 COMPLETE_MIN_RATIO(${COMPLETE_MIN_RATIO}) → null`, () => {
    // 10 → 3 < floor(4)
    const r = validateCompactedDetailed(
      {
        items: [{ faq: "合并后1" }, { faq: "合并后2" }, { faq: "合并后3" }],
      },
      10
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/过度删除/)
    expect(
      validateCompacted(
        {
          items: [{ faq: "合并后1" }, { faq: "合并后2" }, { faq: "合并后3" }],
        },
        10
      )
    ).toBeNull()
  })
  it("≥ COMPLETE_MIN_RATIO → 通过", () => {
    // 10 * 0.4 = 4
    const items = Array.from({ length: 4 }, (_, i) => ({ faq: `x${i}` }))
    expect(validateCompacted({ items }, 10)).toHaveLength(4)
  })
})

describe("defaults", () => {
  it("默认整理周期 1h、分批 30、保留比 0.4", () => {
    expect(DEFAULT_COMPACT_MS).toBe(3_600_000)
    expect(DEFAULT_COMPACT_BATCH_SIZE).toBe(30)
    expect(COMPLETE_MIN_RATIO).toBe(0.4)
  })
})

describe("registerReflectionCompactor 防重入", () => {
  it("上一轮未结束时下一 tick 跳过", async () => {
    const { registerReflectionCompactor } =
      await import("@/lib/agent/reflection-compactor")
    vi.useFakeTimers()
    try {
      seedReflections(5)
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      const qf = vi.fn(() =>
        (async function* () {
          await gate
          yield {
            type: "result",
            subtype: "success",
            structured_output: faqsItems(3, "甲"),
          }
        })()
      )
      const stop = registerReflectionCompactor(
        opts({ compactMs: 1000, queryFn: qf as never })
      )
      await vi.advanceTimersByTimeAsync(1000) // tick1:启动,卡 gate
      expect(qf).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000) // tick2:running=true → 跳过
      expect(qf).toHaveBeenCalledTimes(1)
      release()
      await vi.advanceTimersByTimeAsync(0)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("registerReflectionCompactor 到期判定 + 持久游标(修复重启清零)", () => {
  it("首刷:装配后延迟 firstDelayMs 到期即跑一次(不必等满 scanMs)", async () => {
    const { registerReflectionCompactor } =
      await import("@/lib/agent/reflection-compactor")
    vi.useFakeTimers()
    try {
      seedReflections(5)
      const qf = vi.fn(fakeQuery(faqsItems(3, "甲")))
      // compactMs 大(1h),但 compactAt=0 → now-0 已到期;首刷延迟 50ms
      const stop = registerReflectionCompactor(
        opts({
          compactMs: 3_600_000,
          scanMs: 3_600_000,
          firstDelayMs: 50,
          queryFn: qf as never,
        })
      )
      await vi.advanceTimersByTimeAsync(50)
      expect(qf).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("未到期:now-compactAt < compactMs → 跳过不跑", async () => {
    const { registerReflectionCompactor } =
      await import("@/lib/agent/reflection-compactor")
    vi.useFakeTimers()
    try {
      seedReflections(5)
      repo.setCompactAt(7_000_000 - 500) // 距 now(7_000_000)仅 500 < compactMs 1000
      const qf = vi.fn(fakeQuery({ items: [] }))
      const stop = registerReflectionCompactor(
        opts({
          compactMs: 1000,
          scanMs: 1000,
          firstDelayMs: 10,
          queryFn: qf as never,
        })
      )
      await vi.advanceTimersByTimeAsync(2000)
      expect(qf).not.toHaveBeenCalled()
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("重启补跑:游标陈旧(距 now ≥ compactMs)→ 到期跑,并推进游标到 now", async () => {
    const { registerReflectionCompactor } =
      await import("@/lib/agent/reflection-compactor")
    vi.useFakeTimers()
    try {
      seedReflections(5)
      repo.setCompactAt(7_000_000 - 5000) // 陈旧游标,> compactMs 1000
      const qf = vi.fn(fakeQuery(faqsItems(3, "甲")))
      const stop = registerReflectionCompactor(
        opts({
          compactMs: 1000,
          scanMs: 1000,
          firstDelayMs: 10,
          queryFn: qf as never,
        })
      )
      await vi.advanceTimersByTimeAsync(10) // 首刷即到期
      expect(qf).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(repo.compactAt()).toBe(7_000_000) // 无论成败游标推进到 now
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
