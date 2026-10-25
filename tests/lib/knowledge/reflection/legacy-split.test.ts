import { describe, it, expect, beforeEach } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import type { ReflectionEntry } from "@/lib/core/db/models"
import { usageStats } from "@/lib/model/stats/usage"
import {
  legacyGroups,
  segmentFaq,
  sentenceChunks,
  unitIssue,
  plannedUnitIssue,
  planLegacySplit,
  applyLegacySplit,
  serializeSplitPlan,
  loadSplitPlan,
  renderSplitReport,
  SPLIT_SYSTEM,
  SPLIT_VERIFY_SYSTEM,
  SPLIT_UNIT_MAX_CHARS,
  type SplitDeps,
  type SplitGroupPlan,
  type SerializedSplitPlan,
} from "@/lib/knowledge/reflection/legacy-split"

const vec = () => new Float32Array([1, 0, 0])
const embed = async () => vec()
/** 截止时间:种子整理块 ts 都小于它,apply 写入的新条目 ts(9000+)大于它 */
const BEFORE = 5000

let db: ReturnType<typeof openDb>
let repo: Repo
beforeEach(() => {
  db = openDb(":memory:", 3)
  repo = new Repo(db)
})

/** 模拟存量整理块:同一 ts、同一完整 FAQ 切成多块,meta 带 legacy。 */
function seedLegacy(faq: string, pieces: string[], ts = 1000): number[] {
  return pieces.map((p) => {
    const id = repo.insertKbEntry(
      "human-reflection",
      p,
      `human-reflection:qq:0:${ts}`,
      vec()
    )
    db.prepare(
      "INSERT INTO reflection_meta (chunk_id, channel, group_id, question, answer, status, review_state) VALUES (?, 'qq', '0', NULL, ?, 'approved', 'legacy')"
    ).run(id, faq)
    return id
  })
}

type Unit = { text: string; sourceQuotes: string[] }
type Call = { systemPrompt: string; prompt: string }

/**
 * queryFn 桩:按 systemPrompt 区分拆分与核验调用。
 * split 依据 FAQ_TEXT 返回 units(null = 坏输出);verify 默认全部 supported。
 */
function stubQuery(
  split: (faqText: string) => Unit[] | null,
  verify?: (units: { index: number; text: string }[]) => unknown
) {
  const calls: Call[] = []
  const fn = (args: { prompt: string; options: { systemPrompt: string } }) => {
    const { prompt } = args
    const systemPrompt = args.options.systemPrompt
    calls.push({ systemPrompt, prompt })
    let structured: unknown
    if (systemPrompt === SPLIT_SYSTEM) {
      const m = /<FAQ_TEXT>\n([\s\S]*)\n<\/FAQ_TEXT>/.exec(prompt)
      const units = split(m?.[1] ?? "")
      structured = units === null ? "坏输出" : { units }
    } else if (systemPrompt === SPLIT_VERIFY_SYSTEM) {
      const m = /<UNITS_JSONL>\n([\s\S]*)\n<\/UNITS_JSONL>/.exec(prompt)
      const units = (m?.[1] ?? "")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { index: number; text: string })
      structured = verify
        ? verify(units)
        : { verdicts: units.map((u) => ({ index: u.index, supported: true })) }
    } else {
      throw new Error("未知系统提示")
    }
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        structured_output: structured,
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.001,
      }
    })()
  }
  return { calls, queryFn: fn as never }
}

const plan = (queryFn: SplitDeps["queryFn"], over: Partial<SplitDeps> = {}) =>
  planLegacySplit({
    repo,
    embed,
    queryFn,
    queryTimeoutMs: 0,
    legacyBefore: BEFORE,
    ...over,
  })

const persist = (plans: SplitGroupPlan[]): SerializedSplitPlan =>
  loadSplitPlan(
    JSON.stringify(
      serializeSplitPlan(plans, { legacyBefore: BEFORE, createdAt: 1 })
    )
  )

const apply = (
  p: SerializedSplitPlan,
  e: (text: string) => Promise<Float32Array> = embed
) => applyLegacySplit(repo, p, { embed: e, now: () => 9000 })

/** 知识库可观察状态快照 */
function snapshot() {
  return {
    chunks: db
      .prepare("SELECT id, doc, content, source FROM kb_chunks ORDER BY id")
      .all(),
    meta: db.prepare("SELECT * FROM reflection_meta ORDER BY chunk_id").all(),
    vecs: db.prepare("SELECT COUNT(*) AS n FROM kb_vec").get(),
    audits: db.prepare("SELECT COUNT(*) AS n FROM reflect_compactions").get(),
  }
}

const entry = (over: Partial<ReflectionEntry>): ReflectionEntry => ({
  id: 1,
  content: "c",
  channel: "qq",
  chatId: "0",
  ts: 1000,
  question: null,
  answer: null,
  status: "approved",
  reviewState: "legacy",
  reviewAttempts: 0,
  reviewNote: null,
  ...over,
})

describe("unitIssue", () => {
  const src = "cc-sale 分组支持第三方客户端接入。cc 分组只允许官方客户端。"
  const q = ["cc 分组只允许官方客户端"]
  it("摘录必须是原文逐字子串且不少于 6 字", () => {
    expect(
      unitIssue(
        "cc-sale 分组支持第三方客户端。",
        ["cc-sale 分组支持第三方客户端接入"],
        src
      )
    ).toBeNull()
    expect(
      unitIssue("cc-sale 支持第三方。", ["cc-sale 全部支持"], src)
    ).toMatch(/逐字/)
    expect(unitIssue("cc 分组只允许官方客户端。", ["  "], src)).toMatch(/过短/)
    expect(unitIssue("cc 分组只允许官方客户端。", ["官方客户端"], src)).toMatch(
      /过短/
    )
  })
  it("拒绝指代词、空行、超长、空摘录、脱敏占位符", () => {
    expect(unitIssue("同上,该分组不支持。", q, src)).toMatch(/指代/)
    expect(unitIssue("上述方法同样适用于 cc 分组。", q, src)).toMatch(/指代/)
    expect(unitIssue("这个分组只允许官方客户端。", q, src)).toMatch(/指代/)
    expect(unitIssue("a\n\nb", q, src)).toMatch(/空行/)
    expect(unitIssue("长".repeat(SPLIT_UNIT_MAX_CHARS + 1), q, src)).toMatch(
      /超长/
    )
    expect(unitIssue("", q, src)).toMatch(/为空/)
    expect(unitIssue("cc 分组只允许官方客户端。", [], src)).toMatch(/摘录/)
    expect(unitIssue("cc 分组需要[网络]才能访问。", q, src)).toMatch(/占位符/)
    expect(unitIssue("不要把 [TOKEN] 发到群里。", q, src)).toMatch(/占位符/)
  })
  it("正常表达不误伤", () => {
    for (const t of [
      "在控制台页面上面的分组下拉框切换到 cc 分组。",
      "Claude Code 2.0 以上版本支持 cc 分组。",
      "不确定该怎么选分组时,cc 分组只允许官方客户端。",
      "应该先在令牌页创建令牌,再选择 cc 分组。",
    ])
      expect(unitIssue(t, q, src)).toBeNull()
  })
})

describe("sentenceChunks", () => {
  it("只在句末切,每块 ≤380,拼回原文", () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `第${i}句说明一些事情。`
    ).join("")
    const chunks = sentenceChunks(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 380)).toBe(true)
    expect(chunks.every((c) => /[。！？!?]$/.test(c))).toBe(true)
    expect(chunks.join("")).toBe(text)
  })
  it("换行、连续标点、引号收尾都不丢字", () => {
    const text = `问:怎么办？？\n答:先配置。」再校验!\n\n${"长句".repeat(150)}。尾巴`
    const chunks = sentenceChunks(text, 50)
    expect(chunks.join("")).toBe(text)
    expect(chunks.every((c) => c.length <= 50)).toBe(true)
  })
  it("空行是强制边界,块内不含空行", () => {
    const text = "第一段。\n\n第二段。"
    const chunks = sentenceChunks(text)
    expect(chunks.join("")).toBe(text)
    expect(chunks.some((c) => /\n\s*\n\S/.test(c))).toBe(false)
  })
  it("单句超长时优先在分号/逗号处切,最后才硬切", () => {
    const clause = "条件".repeat(20) + ","
    const text = clause.repeat(30) + "。"
    const chunks = sentenceChunks(text)
    expect(chunks.join("")).toBe(text)
    expect(chunks.every((c) => c.length <= 380)).toBe(true)
    expect(chunks.slice(0, -1).every((c) => c.endsWith(","))).toBe(true)
    const hard = sentenceChunks("字".repeat(800))
    expect(hard.map((c) => c.length)).toEqual([380, 380, 40])
  })
})

describe("segmentFaq", () => {
  it("按段落累积到约 4k 字", () => {
    const para = "段".repeat(1500)
    const faq = [para, para, para, para].join("\n\n")
    const segs = segmentFaq(faq)
    expect(segs.length).toBe(2)
    expect(segs.join("")).toBe(faq)
  })
  it("单换行分隔的行也是切分点(生产 FAQ 几乎没有空行)", () => {
    const line = "问:某问题?答:" + "答".repeat(990) + "。"
    const faq = Array.from({ length: 10 }, () => line).join("\n")
    const segs = segmentFaq(faq)
    expect(segs.join("")).toBe(faq)
    expect(segs.every((s) => s.length <= 4000)).toBe(true)
    expect(segs.length).toBe(3)
  })
  it("单行超长按句子再切", () => {
    const faq = Array.from({ length: 300 }, (_, i) => `第${i}句。`)
      .join("")
      .repeat(5)
    const segs = segmentFaq(faq, 1000)
    expect(segs.join("")).toBe(faq)
    expect(segs.every((s) => s.length <= 1000 && s.endsWith("。"))).toBe(true)
  })
})

describe("legacyGroups", () => {
  it("共享 ts+answer 的块成一组,按 id 升序;非 chatId=0 不入组", () => {
    const groups = legacyGroups(
      [
        entry({ id: 3, content: "FAQ后半", answer: "FAQ全文" }),
        entry({ id: 2, content: "FAQ前半", answer: "FAQ全文" }),
        entry({ id: 5, chatId: "100", answer: "FAQ全文" }),
      ],
      BEFORE
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      faq: "FAQ全文",
      chunkIds: [2, 3],
      contents: ["FAQ前半", "FAQ后半"],
      allApproved: true,
    })
  })
  it("组内有 rejected → allApproved=false", () => {
    const [g] = legacyGroups(
      [
        entry({ id: 2, answer: "A" }),
        entry({ id: 3, answer: "A", status: "rejected" }),
      ],
      BEFORE
    )
    expect(g.allApproved).toBe(false)
  })
  it("无 answer 的整理块按自身 content 单独成组", () => {
    const groups = legacyGroups(
      [entry({ id: 2, content: "甲" }), entry({ id: 3, content: "乙" })],
      BEFORE
    )
    expect(groups.map((g) => g.faq)).toEqual(["甲", "乙"])
  })
  it("只选 ts < before 的块", () => {
    const groups = legacyGroups(
      [
        entry({ id: 2, answer: "旧", ts: 1000 }),
        entry({ id: 3, answer: "新", ts: 2000 }),
        entry({ id: 4, answer: "无 ts", ts: null }),
      ],
      2000
    )
    expect(groups.map((g) => g.faq)).toEqual(["旧"])
  })
})

describe("planLegacySplit", () => {
  const faq =
    "cc-sale 分组支持第三方客户端接入。cc 分组只允许官方客户端。今天 cc 分组倍率 0.8。"
  const goodUnits: Unit[] = [
    {
      text: "cc-sale 分组支持第三方客户端接入。",
      sourceQuotes: ["cc-sale 分组支持第三方客户端接入。"],
    },
    {
      text: "PackyAPI 的 cc 分组只允许官方客户端。",
      sourceQuotes: ["cc 分组只允许官方客户端"],
    },
  ]
  /** 两段的 FAQ:A 段、B 段各约 2500 字(超过单段 4000 上限) */
  const lineA = "甲段说明。".repeat(500) + "\n"
  const lineB = "乙段说明。".repeat(500)
  const twoSeg = lineA + lineB
  const unitA: Unit = {
    text: "甲段说明的稳定知识。",
    sourceQuotes: ["甲段说明。甲段说明。"],
  }

  it("正常拆分:answer 为摘录换行拼接,系统提示恒定,花费记入 legacy-split", async () => {
    usageStats.reset()
    seedLegacy(faq, [faq.slice(0, 20), faq.slice(20)])
    const { queryFn, calls } = stubQuery(() => goodUnits)
    const plans = await plan(queryFn)
    expect(plans).toHaveLength(1)
    expect(plans[0].status).toBe("split")
    expect(plans[0].units.map((u) => [u.text, u.answer])).toEqual([
      [
        "cc-sale 分组支持第三方客户端接入。",
        "cc-sale 分组支持第三方客户端接入。",
      ],
      ["PackyAPI 的 cc 分组只允许官方客户端。", "cc 分组只允许官方客户端"],
    ])
    expect(plans[0].segments).toEqual([
      { chars: faq.length, units: 2, fallback: false, empty: false },
    ])
    expect(calls.map((c) => c.systemPrompt)).toEqual([
      SPLIT_SYSTEM,
      SPLIT_VERIFY_SYSTEM,
    ])
    expect(calls.every((c) => !c.systemPrompt.includes("cc-sale"))).toBe(true)
    expect(calls[0].prompt).toContain(faq)
    expect(usageStats.snapshot()["legacy-split"]?.count).toBe(2)
  })

  it("摘录非子串、含指代、核验不通过/缺失/冲突的条目被丢弃并记原因", async () => {
    seedLegacy(faq, [faq])
    const missing = {
      text: "cc 分组只允许官方客户端接入 PackyAPI。",
      sourceQuotes: ["cc 分组只允许官方客户端"],
    }
    const conflict = {
      text: "cc-sale 分组可以接入第三方客户端。",
      sourceQuotes: ["cc-sale 分组支持第三方客户端接入"],
    }
    const { queryFn } = stubQuery(
      () => [
        ...goodUnits,
        missing,
        conflict,
        { text: "cc-sale 全部免费。", sourceQuotes: ["cc-sale 全部免费"] },
        {
          text: "同上,支持第三方。",
          sourceQuotes: ["cc 分组只允许官方客户端"],
        },
      ],
      () => ({
        // 1 通过;2 不通过;3 缺失;4 同一 index 冲突
        verdicts: [
          { index: 1, supported: true },
          { index: 2, supported: false },
          { index: 4, supported: true },
          { index: 4, supported: false },
        ],
      })
    )
    const [p] = await plan(queryFn)
    expect(p.status).toBe("split")
    expect(p.units.map((u) => u.text)).toEqual([goodUnits[0].text])
    const reasons = Object.fromEntries(p.dropped.map((d) => [d.text, d.reason]))
    expect(reasons["cc-sale 全部免费。"]).toMatch(/摘录/)
    expect(reasons["同上,支持第三方。"]).toMatch(/指代/)
    expect(reasons[goodUnits[1].text]).toMatch(/核验/)
    expect(reasons[missing.text]).toMatch(/核验/)
    expect(reasons[conflict.text]).toMatch(/核验/)
  })

  it("去重:旧整理块排除;正式文档重复丢弃;本轮跨 FAQ 重复丢第二个", async () => {
    const faq2 = "cc-sale 分组支持第三方客户端接入。第二个 FAQ 的其它内容。"
    seedLegacy(faq, [goodUnits[0].text, faq.slice(18)], 1000)
    seedLegacy(faq2, [faq2], 1001)
    repo.insertKbEntry(
      "retrieval/foundation/groups.md",
      goodUnits[1].text,
      "retrieval/foundation/groups.md",
      vec()
    )
    const extra = {
      text: "第二个 FAQ 的其它内容由 PackyAPI 客服说明。",
      sourceQuotes: ["第二个 FAQ 的其它内容。"],
    }
    const { queryFn } = stubQuery((text) =>
      text === faq2 ? [goodUnits[0], extra] : goodUnits
    )
    const plans = await plan(queryFn)
    const byFaq = new Map(plans.map((p) => [p.group.faq, p]))
    const p1 = byFaq.get(faq)!
    // 与本组旧块原文完全相同也不判重;与正式文档相同 → 丢弃(已覆盖,组仍 split)
    expect(p1.status).toBe("split")
    expect(p1.units.map((u) => u.text)).toEqual([goodUnits[0].text])
    expect(p1.dropped).toHaveLength(1)
    expect(p1.dropped[0]).toMatchObject({ text: goodUnits[1].text })
    expect(p1.dropped[0].reason).toMatch(/重复/)
    const p2 = byFaq.get(faq2)!
    expect(p2.units.map((u) => u.text)).toEqual([extra.text])
    expect(p2.dropped).toHaveLength(1)
    expect(p2.dropped[0]).toMatchObject({ text: goodUnits[0].text })
    expect(p2.dropped[0].reason).toMatch(/重复/)
  })

  it("与非整理反思重复的条目被丢弃", async () => {
    seedLegacy(faq, [faq])
    const id = repo.insertKbEntry(
      "human-reflection",
      "cc-sale 分组支持第三方客户端接入。",
      "human-reflection:qq:100:5",
      vec()
    )
    repo.insertReflectionMeta(id, "qq", "100", "q", "a")
    const { queryFn } = stubQuery(() => goodUnits)
    const [p] = await plan(queryFn)
    expect(p.units.map((u) => u.text)).toEqual([goodUnits[1].text])
  })

  it("旧整理块多于候选窗口时仍能找到正式文档重复", async () => {
    for (let i = 0; i < 60; i++)
      seedLegacy(`FAQ${i}`, [`FAQ${i} 内容`], 2000 + i)
    seedLegacy(faq, [faq])
    repo.insertKbEntry(
      "retrieval/foundation/groups.md",
      goodUnits[1].text,
      "retrieval/foundation/groups.md",
      // 比所有旧块都远,只有放大候选池才取得到
      new Float32Array([0.9, 0.43589, 0])
    )
    const { queryFn } = stubQuery((text) => (text === faq ? goodUnits : []))
    const plans = await plan(queryFn, { dupTopK: 1 })
    const p = plans.find((x) => x.group.faq === faq)!
    expect(p.units.map((u) => u.text)).toEqual([goodUnits[0].text])
  })

  it("一段条目全部未过校验 → 只对该段句末重切,组 fallback", async () => {
    seedLegacy(twoSeg, [twoSeg.slice(0, 500), twoSeg.slice(500)])
    const { queryFn } = stubQuery((text) =>
      text.startsWith("甲")
        ? [unitA]
        : [{ text: "乙段说明的知识。", sourceQuotes: ["原文没有这句话。"] }]
    )
    const [p] = await plan(queryFn)
    expect(p.status).toBe("fallback")
    expect(p.segments.map((s) => [s.fallback, s.empty])).toEqual([
      [false, false],
      [true, false],
    ])
    expect(p.units[0].text).toBe(unitA.text)
    const fallbackUnits = p.units.slice(1)
    expect(fallbackUnits.length).toBe(p.segments[1].units)
    // 句末重切只产出原文连续片段(重复片段被本轮去重丢弃)
    expect(fallbackUnits.length).toBeGreaterThan(0)
    expect(fallbackUnits.every((u) => lineB.includes(u.text))).toBe(true)
    expect(fallbackUnits.every((u) => u.text.endsWith("。"))).toBe(true)
    expect(fallbackUnits.every((u) => u.answer === u.text)).toBe(true)
    expect(fallbackUnits.every((u) => u.text.length <= 380)).toBe(true)
  })

  it("一段被模型判为无稳定知识(空数组) → needs_review,不替换", async () => {
    const ids = seedLegacy(twoSeg, [twoSeg.slice(0, 500), twoSeg.slice(500)])
    const { queryFn } = stubQuery((text) =>
      text.startsWith("甲") ? [unitA] : []
    )
    const plans = await plan(queryFn)
    expect(plans[0].status).toBe("needs_review")
    expect(plans[0].segments.map((s) => s.empty)).toEqual([false, true])
    const before = snapshot()
    const res = await apply(persist(plans))
    expect(res).toMatchObject({ replaced: 0, refused: 0, errored: 0 })
    expect(snapshot()).toEqual(before)
    expect(
      repo
        .reflectionEntries()
        .map((e) => e.id)
        .sort()
    ).toEqual(ids.sort())
  })

  it("多段组中一段调用失败 → 整组 failed,其它组照常", async () => {
    seedLegacy(twoSeg, [twoSeg], 1000)
    seedLegacy(faq, [faq], 1001)
    const { queryFn } = stubQuery((text) => {
      if (text.startsWith("乙")) throw new Error("relay 500")
      return text.startsWith("甲") ? [unitA] : goodUnits
    })
    const plans = await plan(queryFn)
    const byFaq = new Map(plans.map((p) => [p.group.faq, p]))
    expect(byFaq.get(twoSeg)!.status).toBe("failed")
    expect(byFaq.get(twoSeg)!.dropped[0].reason).toMatch(/relay 500/)
    expect(byFaq.get(faq)!.status).toBe("split")
  })

  it("拆分输出无法解析 → failed,其条目不参与本轮去重", async () => {
    const faq0 = "cc-sale 分组支持第三方客户端接入。另一个 FAQ 的说明。"
    seedLegacy(faq0, [faq0], 1000)
    seedLegacy(faq, [faq], 1001)
    let verifyCalls = 0
    const { queryFn } = stubQuery(
      (text) => (text === faq0 ? [goodUnits[0]] : [goodUnits[0]]),
      (units) => {
        verifyCalls++
        // 第一组核验输出坏掉 → failed;它的条目不应挡住第二组
        return verifyCalls === 1
          ? "坏"
          : {
              verdicts: units.map((u) => ({ index: u.index, supported: true })),
            }
      }
    )
    const plans = await plan(queryFn)
    expect(plans[0].status).toBe("failed")
    expect(plans[0].dropped[0].reason).toMatch(/无法解析/)
    expect(plans[1].status).toBe("split")
    expect(plans[1].units.map((u) => u.text)).toEqual([goodUnits[0].text])
  })

  it("组内含 rejected 块 → skipped,不调模型", async () => {
    const [, b] = seedLegacy(faq, [faq.slice(0, 10), faq.slice(10)])
    repo.setReflectionStatus(b, "rejected")
    const { queryFn, calls } = stubQuery(() => goodUnits)
    const [p] = await plan(queryFn)
    expect(p.status).toBe("skipped")
    expect(calls).toHaveLength(0)
  })

  it("legacyBefore 截止:已写入的拆分产物不会被重新选中", async () => {
    seedLegacy(faq, [faq], 1000)
    const { queryFn } = stubQuery(() => goodUnits)
    const first = await plan(queryFn)
    expect((await apply(persist(first))).replaced).toBe(1)
    // 新条目同为 chatId=0、review_state=legacy,但 ts=9000 ≥ 截止
    expect(repo.reflectionEntries().every((e) => e.chatId === "0")).toBe(true)
    const { queryFn: q2, calls } = stubQuery(() => goodUnits)
    expect(await plan(q2)).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe("serializeSplitPlan / loadSplitPlan", () => {
  const faq = "cc-sale 分组支持第三方客户端接入。"
  const sampleUnits: Unit[] = [
    {
      text: "PackyAPI 的 cc-sale 分组支持第三方客户端接入。",
      sourceQuotes: [faq],
    },
  ]

  it("往返:JSON 不含 embedding,读回结构一致", async () => {
    seedLegacy(faq, [faq])
    const plans = await plan(stubQuery(() => sampleUnits).queryFn)
    const s = serializeSplitPlan(plans, { legacyBefore: BEFORE, createdAt: 7 })
    const json = JSON.stringify(s)
    expect(json).not.toMatch(/embedding/)
    expect(json).not.toContain(`"faq"`)
    expect(loadSplitPlan(json)).toEqual(s)
    expect(loadSplitPlan(JSON.parse(json))).toEqual(s)
    expect(s.groups[0]).toMatchObject({
      chunkIds: plans[0].group.chunkIds,
      status: "split",
      units: [{ text: sampleUnits[0].text, answer: faq }],
      segments: [
        { chars: faq.length, units: 1, fallback: false, empty: false },
      ],
    })
    expect(s.groups[0].contentSha256[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it("结构不合法 → 抛错", async () => {
    seedLegacy(faq, [faq])
    const plans = await plan(stubQuery(() => sampleUnits).queryFn)
    const good = serializeSplitPlan(plans, {
      legacyBefore: BEFORE,
      createdAt: 7,
    })
    // 故意构造不合法结构,需要绕开类型
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mutate = (f: (p: Record<string, any>) => void) => {
      const p = JSON.parse(JSON.stringify(good))
      f(p)
      return p
    }
    expect(() => loadSplitPlan("{")).toThrow(/JSON/)
    expect(() => loadSplitPlan(mutate((p) => (p.version = 2)))).toThrow(
      /version/
    )
    expect(() => loadSplitPlan(mutate((p) => delete p.legacyBefore))).toThrow(
      /legacyBefore/
    )
    expect(() =>
      loadSplitPlan(mutate((p) => (p.groups[0].status = "done")))
    ).toThrow(/status/)
    expect(() =>
      loadSplitPlan(mutate((p) => (p.groups[0].contentSha256 = ["xyz"])))
    ).toThrow(/sha256/)
    expect(() =>
      loadSplitPlan(
        mutate((p) => p.groups[0].contentSha256.push(good.groups[0].faqSha256))
      )
    ).toThrow(/长度/)
    expect(() =>
      loadSplitPlan(
        mutate((p) => (p.groups[0].units[0].text = "长".repeat(381)))
      )
    ).toThrow(/超过/)
    expect(() =>
      loadSplitPlan(mutate((p) => (p.groups[0].units[0].answer = "")))
    ).toThrow(/answer/)
    expect(() =>
      loadSplitPlan(mutate((p) => p.groups.push(p.groups[0])))
    ).toThrow(/重复/)
    expect(() =>
      loadSplitPlan(mutate((p) => (p.groups[0].segments[0].empty = "no")))
    ).toThrow(/empty/)
  })
})

describe("applyLegacySplit", () => {
  const faq = "cc-sale 分组支持第三方客户端接入。cc 分组只允许官方客户端。"
  const faq2 = "第二个 FAQ 的独立内容。"
  const units: Unit[] = [
    {
      text: "cc-sale 分组支持第三方客户端接入。",
      sourceQuotes: ["cc-sale 分组支持第三方客户端接入。"],
    },
  ]
  const units2: Unit[] = [
    {
      text: "PackyAPI 第二个 FAQ 的独立内容。",
      sourceQuotes: ["第二个 FAQ 的独立内容。"],
    },
  ]
  const twoGroups = async () => {
    const old1 = seedLegacy(faq, [faq.slice(0, 18), faq.slice(18)], 1000)
    const old2 = seedLegacy(faq2, [faq2], 1001)
    const plans = await plan(
      stubQuery((t) => (t === faq ? units : units2)).queryFn
    )
    return { old1, old2, saved: persist(plans) }
  }

  it("serialize→load→apply:旧块消失、新条目 legacy/group_id=0/answer=摘录,审计完整", async () => {
    const { old1, old2, saved } = await twoGroups()
    // dry-run 之后人工驳回第二组的旧块
    repo.setReflectionStatus(old2[0], "rejected")
    const res = await apply(saved)
    expect(res).toMatchObject({ replaced: 1, refused: 1, errored: 0 })
    expect(res.details.find((d) => d.outcome === "refused")?.reason).toMatch(
      /rejected/
    )

    const entries = repo.reflectionEntries()
    for (const id of old1)
      expect(entries.find((e) => e.id === id)).toBeUndefined()
    expect(entries.find((e) => e.id === old2[0])?.status).toBe("rejected")
    const fresh = entries.find((e) => e.content === units[0].text)!
    expect(fresh).toMatchObject({
      chatId: "0",
      ts: 9000,
      question: null,
      answer: "cc-sale 分组支持第三方客户端接入。",
      status: "approved",
      reviewState: "legacy",
    })
    const meta = db
      .prepare("SELECT group_id FROM reflection_meta WHERE chunk_id = ?")
      .get(fresh.id) as { group_id: string }
    expect(meta.group_id).toBe("0")
    const audits = db
      .prepare(
        "SELECT before_count, after_count, before_json, after_json FROM reflect_compactions"
      )
      .all() as {
      before_count: number
      after_count: number
      before_json: string
      after_json: string
    }[]
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ before_count: 2, after_count: 1 })
    expect(JSON.parse(audits[0].before_json)).toEqual([
      { id: old1[0], content: faq.slice(0, 18), faq },
      { id: old1[1], content: faq.slice(18) },
    ])
    expect(JSON.parse(audits[0].after_json)).toEqual([
      { text: units[0].text, answer: units[0].sourceQuotes[0] },
    ])
  })

  it("同一计划 apply 两次 → 第二次全部 refused,DB 不变", async () => {
    const { saved } = await twoGroups()
    expect((await apply(saved)).replaced).toBe(2)
    const after = snapshot()
    const again = await apply(saved)
    expect(again).toMatchObject({ replaced: 0, refused: 2, errored: 0 })
    expect(snapshot()).toEqual(after)
  })

  it("旧块正文被改 / review_state 被改 → 该组 refused", async () => {
    const { old1, old2, saved } = await twoGroups()
    db.prepare("UPDATE kb_chunks SET content = '被人工改过' WHERE id = ?").run(
      old1[1]
    )
    db.prepare(
      "UPDATE reflection_meta SET review_state = 'accepted' WHERE chunk_id = ?"
    ).run(old2[0])
    const before = snapshot()
    const res = await apply(saved)
    expect(res).toMatchObject({ replaced: 0, refused: 2 })
    expect(res.details.map((d) => d.reason).join("|")).toMatch(/正文已变化/)
    expect(res.details.map((d) => d.reason).join("|")).toMatch(/review_state/)
    expect(snapshot()).toEqual(before)
  })

  it("单组异常记 errored,继续下一组", async () => {
    const { old2, saved } = await twoGroups()
    const res = await apply(saved, async (t: string) => {
      if (t === units[0].text) throw new Error("嵌入挂了")
      return vec()
    })
    expect(res).toMatchObject({ replaced: 1, refused: 0, errored: 1 })
    expect(res.details.find((d) => d.outcome === "errored")?.reason).toMatch(
      /嵌入挂了/
    )
    expect(
      repo.reflectionEntries().find((e) => e.id === old2[0])
    ).toBeUndefined()
  })

  const q = units[0].sourceQuotes[0]
  it.each([
    ["指代词", { text: "同上,cc-sale 支持第三方。", answer: q }, /指代词/],
    ["占位符", { text: "cc-sale 支持 [TOKEN] 接入。", answer: q }, /占位符/],
    ["超长", { text: "长".repeat(381), answer: q }, /超长/],
    [
      "摘录非子串",
      { text: q, answer: `${q}\n原文里没有这句话。` },
      /摘录不是当前 FAQ 的逐字子串/,
    ],
    // 兜底条目(answer === text)必须是 FAQ 原文片段
    [
      "兜底非子串",
      { text: "原文里没有这句话。", answer: "原文里没有这句话。" },
      /兜底条目/,
    ],
  ])(
    "计划条目被手改(%s)→ 该组 refused,其余组照常替换",
    async (_name, unit, reason) => {
      const { old1, old2, saved } = await twoGroups()
      const tampered: SerializedSplitPlan = {
        ...saved,
        groups: [{ ...saved.groups[0], units: [unit] }, saved.groups[1]],
      }
      const res = await apply(tampered)
      expect(res).toMatchObject({ replaced: 1, refused: 1, errored: 0 })
      const refused = res.details.find((d) => d.outcome === "refused")!
      expect(refused.chunkIds).toEqual(old1)
      expect(refused.reason).toMatch(/条目 1 复核未通过/)
      expect(refused.reason).toMatch(reason)
      const entries = repo.reflectionEntries()
      for (const id of old1)
        expect(entries.find((e) => e.id === id)).toBeDefined()
      expect(entries.find((e) => e.id === old2[0])).toBeUndefined()
      expect(entries.find((e) => e.content === unit.text)).toBeUndefined()
    }
  )

  it("复核:合法的兜底条目与跨行摘录条目可通过", () => {
    // 兜底条目是原文片段,原文含「上述」也不误伤
    expect(
      plannedUnitIssue(
        { text: "如上述配置。", answer: "如上述配置。" },
        "前文。如上述配置。后文。"
      )
    ).toBeNull()
    // 跨行摘录拆出的短行不受最短摘录限制
    expect(
      plannedUnitIssue(
        { text: "PackyAPI 的说明。", answer: "第一行说明很长的内容\n短" },
        "第一行说明很长的内容\n短\n第三行。"
      )
    ).toBeNull()
  })

  it("只有 split/fallback 且有条目的组会被替换", async () => {
    seedLegacy(faq, [faq])
    const plans = await plan(stubQuery(() => units).queryFn)
    const saved = persist(plans)
    const base = saved.groups[0]
    const variants = (["needs_review", "failed", "skipped"] as const).map(
      (status) => ({ ...base, status })
    )
    const before = snapshot()
    const res = await apply({
      ...saved,
      groups: [...variants, { ...base, units: [] }],
    })
    expect(res).toMatchObject({ replaced: 0, refused: 0, errored: 0 })
    expect(snapshot()).toEqual(before)
  })
})

describe("renderSplitReport", () => {
  it("输出总览、段级覆盖与逐组明细", async () => {
    const faq = "问:" + "很长的问题。".repeat(30)
    seedLegacy(faq, [faq])
    const plans = await plan(
      stubQuery(() => [
        { text: "条目甲。", sourceQuotes: ["很长的问题。很长的问题。"] },
        { text: "同上,条目乙。", sourceQuotes: ["很长的问题。很长的问题。"] },
      ]).queryFn
    )
    const md = renderSplitReport(persist(plans))
    expect(md).toContain("组数:1")
    expect(md).toMatch(/split:1/)
    expect(md).toMatch(/needs_review:0/)
    expect(md).toContain("新条目:1")
    expect(md).toContain("丢弃:1")
    expect(md).toContain("条目甲")
    expect(md).toContain("条目含指代词")
    expect(md).toContain(`段 1:输入 ${faq.length} 字 → 产出 1 条`)
    expect(md).not.toContain(faq)
  })
})
