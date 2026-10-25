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
  planLegacySplit,
  applyLegacySplit,
  renderSplitReport,
  SPLIT_SYSTEM,
  SPLIT_VERIFY_SYSTEM,
  SPLIT_UNIT_MAX_CHARS,
} from "@/lib/knowledge/reflection/legacy-split"

const vec = () => new Float32Array([1, 0, 0])
const embed = async () => vec()

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
 * split 依据 FAQ_TEXT 返回 units;verify 默认全部 supported。
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
  it("摘录必须是原文逐字子串", () => {
    expect(
      unitIssue(
        "cc-sale 分组支持第三方客户端。",
        ["cc-sale 分组支持第三方客户端接入"],
        src
      )
    ).toBeNull()
    expect(
      unitIssue("cc-sale 支持第三方。", ["cc-sale 全部支持"], src)
    ).toMatch(/摘录/)
    expect(unitIssue("cc 分组只允许官方客户端。", ["  "], src)).toMatch(/摘录/)
  })
  it("拒绝指代词、空行、超长、空摘录", () => {
    const q = ["cc 分组只允许官方客户端"]
    expect(unitIssue("同上,该分组不支持。", q, src)).toMatch(/指代/)
    expect(unitIssue("上述方法同样适用于 cc 分组。", q, src)).toMatch(/指代/)
    expect(unitIssue("这个分组只允许官方客户端。", q, src)).toMatch(/指代/)
    expect(unitIssue("a\n\nb", q, src)).toMatch(/空行/)
    expect(unitIssue("长".repeat(SPLIT_UNIT_MAX_CHARS + 1), q, src)).toMatch(
      /超长/
    )
    expect(unitIssue("", q, src)).toMatch(/为空/)
    expect(unitIssue("cc 分组只允许官方客户端。", [], src)).toMatch(/摘录/)
  })
  it("正常表达不误伤", () => {
    const q = ["cc 分组只允许官方客户端"]
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
    const groups = legacyGroups([
      entry({ id: 3, content: "FAQ后半", answer: "FAQ全文" }),
      entry({ id: 2, content: "FAQ前半", answer: "FAQ全文" }),
      entry({ id: 5, chatId: "100", answer: "FAQ全文" }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      faq: "FAQ全文",
      chunkIds: [2, 3],
      contents: ["FAQ前半", "FAQ后半"],
      allApproved: true,
    })
  })
  it("组内有 rejected → allApproved=false", () => {
    const [g] = legacyGroups([
      entry({ id: 2, answer: "A" }),
      entry({ id: 3, answer: "A", status: "rejected" }),
    ])
    expect(g.allApproved).toBe(false)
  })
  it("无 answer 的整理块按自身 content 单独成组", () => {
    const groups = legacyGroups([
      entry({ id: 2, content: "甲" }),
      entry({ id: 3, content: "乙" }),
    ])
    expect(groups.map((g) => g.faq)).toEqual(["甲", "乙"])
  })
  it("before 截止:跳过已是拆分产物的较新块,重跑不会再拆", () => {
    const groups = legacyGroups(
      [
        entry({ id: 2, answer: "旧", ts: 1000 }),
        entry({ id: 3, answer: "新", ts: 5000 }),
      ],
      { before: 2000 }
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

  it("正常拆分:answer 为摘录换行拼接,花费记入 legacy-split", async () => {
    usageStats.reset()
    seedLegacy(faq, [faq.slice(0, 20), faq.slice(20)])
    const { queryFn, calls } = stubQuery(() => goodUnits)
    const plans = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    expect(plans).toHaveLength(1)
    expect(plans[0].status).toBe("split")
    expect(plans[0].units.map((u) => [u.text, u.answer])).toEqual([
      [
        "cc-sale 分组支持第三方客户端接入。",
        "cc-sale 分组支持第三方客户端接入。",
      ],
      ["PackyAPI 的 cc 分组只允许官方客户端。", "cc 分组只允许官方客户端"],
    ])
    // 系统提示恒定,FAQ 只出现在 user 侧
    expect(calls.map((c) => c.systemPrompt)).toEqual([
      SPLIT_SYSTEM,
      SPLIT_VERIFY_SYSTEM,
    ])
    expect(calls.every((c) => !c.systemPrompt.includes("cc-sale"))).toBe(true)
    expect(calls[0].prompt).toContain(faq)
    expect(usageStats.snapshot()["legacy-split"]?.count).toBe(2)
  })

  it("摘录不是子串、含指代、核验未通过的条目被丢弃并记原因", async () => {
    seedLegacy(faq, [faq])
    const { queryFn } = stubQuery(
      () => [
        ...goodUnits,
        { text: "cc-sale 全部免费。", sourceQuotes: ["cc-sale 全部免费"] },
        {
          text: "同上,支持第三方。",
          sourceQuotes: ["cc 分组只允许官方客户端"],
        },
      ],
      () => ({
        verdicts: [
          { index: 1, supported: true },
          { index: 2, supported: false },
        ],
      })
    )
    const [plan] = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    expect(plan.status).toBe("split")
    expect(plan.units.map((u) => u.text)).toEqual([goodUnits[0].text])
    const reasons = Object.fromEntries(
      plan.dropped.map((d) => [d.text, d.reason])
    )
    expect(reasons["cc-sale 全部免费。"]).toMatch(/摘录/)
    expect(reasons["同上,支持第三方。"]).toMatch(/指代/)
    expect(reasons[goodUnits[1].text]).toMatch(/核验/)
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
    const plans = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    const byFaq = new Map(plans.map((p) => [p.group.faq, p]))
    const p1 = byFaq.get(faq)!
    // 与本组旧块原文完全相同也不判重;与正式文档相同 → 丢弃
    expect(p1.units.map((u) => u.text)).toEqual([goodUnits[0].text])
    expect(p1.dropped).toHaveLength(1)
    expect(p1.dropped[0]).toMatchObject({ text: goodUnits[1].text })
    expect(p1.dropped[0].reason).toMatch(/重复/)
    // 第二个 FAQ 拆出与第一个相同的条目 → 丢第二个
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
    const [plan] = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    expect(plan.units.map((u) => u.text)).toEqual([goodUnits[1].text])
  })

  it("旧整理块多于候选窗口时仍能找到正式文档重复", async () => {
    const ids: number[] = []
    for (let i = 0; i < 60; i++)
      ids.push(...seedLegacy(`FAQ${i}`, [`FAQ${i} 内容`], 2000 + i))
    seedLegacy(faq, [faq])
    repo.insertKbEntry(
      "retrieval/foundation/groups.md",
      goodUnits[1].text,
      "retrieval/foundation/groups.md",
      // 比所有旧块都远,只有放大候选池才取得到
      new Float32Array([0.9, 0.43589, 0])
    )
    const { queryFn } = stubQuery((text) => (text === faq ? goodUnits : []))
    const plans = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
      dupTopK: 1,
    })
    const plan = plans.find((p) => p.group.faq === faq)!
    expect(plan.units.map((u) => u.text)).toEqual([goodUnits[0].text])
  })

  it("一条有效条目都没有时按句末确定性重切,状态 fallback", async () => {
    seedLegacy(faq, [faq.slice(0, 10), faq.slice(10)])
    const { queryFn } = stubQuery(() => [])
    const [plan] = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    expect(plan.status).toBe("fallback")
    expect(plan.units.map((u) => u.text).join("")).toBe(faq)
    expect(plan.units.every((u) => u.answer === u.text)).toBe(true)
  })

  it("组内含 rejected 块 → skipped,不调模型", async () => {
    const [, b] = seedLegacy(faq, [faq.slice(0, 10), faq.slice(10)])
    repo.setReflectionStatus(b, "rejected")
    const { queryFn, calls } = stubQuery(() => goodUnits)
    const [plan] = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    expect(plan.status).toBe("skipped")
    expect(calls).toHaveLength(0)
  })

  it("拆分输出无法解析 → 整组 failed(不以残缺结果替换),也不污染本轮去重", async () => {
    const faq2 = "另一个 FAQ 也写着 cc-sale 分组支持第三方客户端接入。"
    seedLegacy(faq, [faq], 1000)
    seedLegacy(faq2, [faq2], 1001)
    let n = 0
    const { queryFn } = stubQuery((text) => {
      n++
      if (text === faq2) return null
      return [goodUnits[0]]
    })
    const plans = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    expect(n).toBe(2)
    const failed = plans.find((p) => p.group.faq === faq2)!
    expect(failed.status).toBe("failed")
    expect(failed.dropped[0].reason).toMatch(/无法解析/)
    expect(plans.find((p) => p.group.faq === faq)!.status).toBe("split")
  })

  it("调用抛错 → 该组 failed,其它组照常", async () => {
    seedLegacy(faq, [faq], 1000)
    seedLegacy("第二个 FAQ。", ["第二个 FAQ。"], 1001)
    const { queryFn } = stubQuery((text) => {
      if (text === faq) throw new Error("relay 500")
      return []
    })
    const plans = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    const byFaq = new Map(plans.map((p) => [p.group.faq, p]))
    expect(byFaq.get(faq)!.status).toBe("failed")
    expect(byFaq.get(faq)!.dropped[0].reason).toMatch(/relay 500/)
    expect(byFaq.get("第二个 FAQ。")!.status).toBe("fallback")
  })
})

describe("applyLegacySplit", () => {
  const faq = "cc-sale 分组支持第三方客户端接入。cc 分组只允许官方客户端。"
  const units: Unit[] = [
    {
      text: "cc-sale 分组支持第三方客户端接入。",
      sourceQuotes: ["cc-sale 分组支持第三方客户端接入。"],
    },
  ]

  it("替换后旧块消失、新条目 legacy/group_id=0/answer=摘录,写审计;expectedStatus 拒绝被改过的组", async () => {
    const faq2 = "第二个 FAQ 的独立内容。"
    const old1 = seedLegacy(faq, [faq.slice(0, 18), faq.slice(18)], 1000)
    const old2 = seedLegacy(faq2, [faq2], 1001)
    const { queryFn } = stubQuery((t) =>
      t === faq
        ? units
        : [
            {
              text: "PackyAPI 第二个 FAQ 的独立内容。",
              sourceQuotes: ["第二个 FAQ 的独立内容。"],
            },
          ]
    )
    const plans = await planLegacySplit({
      repo,
      embed,
      queryFn,
      queryTimeoutMs: 0,
    })
    // dry-run 之后人工驳回第二组的旧块
    repo.setReflectionStatus(old2[0], "rejected")
    const res = await applyLegacySplit(repo, plans, () => 9000)
    expect(res).toEqual({ replaced: 1, refused: 1 })

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
      .prepare("SELECT before_json, after_json FROM reflect_compactions")
      .all() as { before_json: string; after_json: string }[]
    expect(audits).toHaveLength(1)
    expect(JSON.parse(audits[0].before_json)).toEqual([
      faq.slice(0, 18),
      faq.slice(18),
    ])
    expect(JSON.parse(audits[0].after_json)).toEqual([units[0].text])
  })

  it("skipped / failed / 无条目的组不替换", async () => {
    const [id] = seedLegacy(faq, [faq])
    const group = legacyGroups(repo.reflectionEntries())[0]
    const res = await applyLegacySplit(
      repo,
      [
        { group, status: "skipped", units: [], dropped: [] },
        {
          group,
          status: "failed",
          units: [{ text: "x", answer: "x", embedding: vec() }],
          dropped: [],
        },
        { group, status: "fallback", units: [], dropped: [] },
      ],
      () => 9000
    )
    expect(res).toEqual({ replaced: 0, refused: 0 })
    expect(repo.reflectionEntries().map((e) => e.id)).toEqual([id])
  })
})

describe("renderSplitReport", () => {
  it("输出总览与逐组明细", () => {
    const group = {
      faq: "问:" + "很长的问题".repeat(30),
      chunkIds: [1, 2],
      contents: ["a", "b"],
      allApproved: true,
    }
    const md = renderSplitReport([
      {
        group,
        status: "split",
        units: [{ text: "条目甲", answer: "摘录甲", embedding: vec() }],
        dropped: [{ text: "条目乙", reason: "条目含指代词" }],
      },
      { group, status: "skipped", units: [], dropped: [] },
    ])
    expect(md).toContain("组数:2")
    expect(md).toMatch(/split:1/)
    expect(md).toMatch(/skipped:1/)
    expect(md).toContain("新条目:1")
    expect(md).toContain("丢弃:1")
    expect(md).toContain("条目甲")
    expect(md).toContain("条目乙")
    expect(md).toContain("条目含指代词")
    expect(md).not.toContain(group.faq)
  })
})
