import { describe, it, expect } from "vitest"
import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  COMPOSE_OUTPUT_SCHEMA,
  composePromotion,
  MAX_MERGE_CHUNKS,
  RETRIEVAL_DOMAINS,
  renderUnit,
  resolveTarget,
  trustedSourceUrl,
  unitShapeIssue,
  validateUnit,
  type ComposeUnit,
} from "@/lib/knowledge/reflection/promote-compose"
import { splitCompactedFaq } from "@/lib/knowledge/reflection/compact-chunks"

const unit = (over: Partial<ComposeUnit> = {}): ComposeUnit => ({
  product: "Packy",
  protocol: "OpenAI-compatible",
  task: "无效令牌诊断",
  body: "收到 401 时停止重试，核对当前 token 与 base_url",
  sourceUrl: "",
  volatility: "错误文案可能更新",
  ...over,
})

// docs/kb/** 是 gitignore 的(.gitignore:47),只有 .gitkeep 进版本库,CI 是裸
// checkout + pnpm check——所以在 CI 里这棵树根本不存在。这条不变量在 CI 无意义
// (没有语料可比),但在任何有语料树的机器上照常生效,而域改名只会在那种机器上做。
// 不用 existsSync 直接断言,否则 `pnpm check` 会在 CI 里 ENOENT 红掉。
const RETRIEVAL_ROOT = resolve("docs/kb/retrieval")

describe.skipIf(!existsSync(RETRIEVAL_ROOT))("RETRIEVAL_DOMAINS", () => {
  it("白名单与 docs/kb/retrieval 下的实际目录一致", () => {
    const dirs = readdirSync(RETRIEVAL_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    expect([...RETRIEVAL_DOMAINS].sort()).toEqual(dirs)
  })
})

// 与语料树无关的廉价自检,CI 裸检出里也照跑:上面那条 skip 掉时,至少还有这一条。
describe("RETRIEVAL_DOMAINS 自检", () => {
  it("无重复项", () => {
    expect(new Set(RETRIEVAL_DOMAINS).size).toBe(RETRIEVAL_DOMAINS.length)
  })
})

describe("resolveTarget", () => {
  const candidates = ["retrieval/faq/api-errors.md", "retrieval/token/x.md"]
  const noneExists = () => false

  it("merge 只接受本轮真实候选", () => {
    expect(
      resolveTarget(
        { mode: "merge", doc: candidates[0] },
        candidates,
        noneExists
      )
    ).toEqual({ ok: true, kind: "merge", doc: "retrieval/faq/api-errors.md" })
    // 编造的路径(哪怕格式合法)一律拒绝
    expect(
      resolveTarget(
        { mode: "merge", doc: "retrieval/faq/hack.md" },
        candidates,
        noneExists
      ).ok
    ).toBe(false)
    // 历史层 promoted/ 不在候选里,天然被拒
    expect(
      resolveTarget(
        { mode: "merge", doc: "promoted/reflection-1.md" },
        candidates,
        noneExists
      ).ok
    ).toBe(false)
  })

  it("候选里混入非 canonical 路径时同样拒绝", () => {
    // 不变量不能只靠上游过滤:即便调用方把 promoted/ 或带穿越的路径塞进候选,
    // merge 也必须拒——否则"路径由程序定"这条契约就只在注释里成立。
    // 两种拒绝原因分开:doc 在候选内却非 canonical 时若报"不在候选内"会误导排查
    expect(
      resolveTarget(
        { mode: "merge", doc: "promoted/reflection-1.md" },
        [...candidates, "promoted/reflection-1.md"],
        noneExists
      )
    ).toEqual({ ok: false, reason: "目标文档非 retrieval/ canonical 路径" })
    expect(
      resolveTarget(
        { mode: "merge", doc: "retrieval/../outside.md" },
        [...candidates, "retrieval/../outside.md"],
        noneExists
      ).ok
    ).toBe(false)
  })

  it("new 校验域名白名单与 slug,拼出 retrieval/ 路径", () => {
    expect(
      resolveTarget(
        { mode: "new", domain: "faq", slug: "refund-note" },
        [],
        noneExists
      )
    ).toEqual({ ok: true, kind: "new", doc: "retrieval/faq/refund-note.md" })
    expect(
      resolveTarget(
        { mode: "new", domain: "secrets", slug: "refund-note" },
        [],
        noneExists
      ).ok
    ).toBe(false)
    expect(
      resolveTarget(
        { mode: "new", domain: "faq", slug: "../../etc/passwd" },
        [],
        noneExists
      ).ok
    ).toBe(false)
    expect(
      resolveTarget(
        { mode: "new", domain: "faq", slug: "Refund_Note" },
        [],
        noneExists
      ).ok
    ).toBe(false)
  })

  it("new 撞上已有文件时转 merge,不覆盖", () => {
    expect(
      resolveTarget(
        { mode: "new", domain: "faq", slug: "refund-note" },
        [],
        () => true
      )
    ).toEqual({ ok: true, kind: "merge", doc: "retrieval/faq/refund-note.md" })
  })

  it("mode 非法 / 缺字段被拒", () => {
    expect(resolveTarget({}, [], noneExists).ok).toBe(false)
    expect(resolveTarget({ mode: "overwrite" }, [], noneExists).ok).toBe(false)
    expect(resolveTarget({ mode: "merge" }, [], noneExists).ok).toBe(false)
    expect(
      resolveTarget({ mode: "new", slug: "x-y-z" }, [], noneExists).ok
    ).toBe(false)
  })
})

describe("trustedSourceUrl", () => {
  it("只有逐字出现在原文里的 URL 才可信", () => {
    const raw = "见 https://docs.packyapi.ai/docs/register/ 说明"
    expect(
      trustedSourceUrl("https://docs.packyapi.ai/docs/register/", raw)
    ).toBe("https://docs.packyapi.ai/docs/register/")
    expect(trustedSourceUrl("https://example.com/made-up", raw)).toBeNull()
    expect(trustedSourceUrl("", raw)).toBeNull()
    expect(
      trustedSourceUrl("ftp://docs.packyapi.ai/", "ftp://docs.packyapi.ai/")
    ).toBeNull()
  })

  it("吞了中文标点的 URL 不算可信", () => {
    // 原文「见 https://x/a。」无空格时,模型照抄会得到带全角句号的 URL;
    // 若只查 includes,假尾巴会被一并放行到来源行
    const raw = "见 https://x/a。"
    expect(trustedSourceUrl("https://x/a。", raw)).toBeNull()
    expect(trustedSourceUrl("https://x/a，", "见 https://x/a，")).toBeNull()
    // 纯 ASCII 的同一段则放行
    expect(trustedSourceUrl("https://x/a", "见 https://x/a")).toBe(
      "https://x/a"
    )
  })
})

describe("renderUnit", () => {
  it("标题紧跟正文,无空行,来源行固定形态", () => {
    const r = renderUnit(unit(), {
      chunkId: 42,
      date: "2026-09-16",
      rawSources: "问题原文",
    })
    expect(r.content).toBe(
      "# 产品：Packy；协议：OpenAI-compatible；任务：无效令牌诊断\n" +
        "收到 401 时停止重试，核对当前 token 与 base_url。来源：QQ 群客服会话反思 #42；核验日期：2026-09-16；动态性：错误文案可能更新\n"
    )
    // 标题与正文之间没有空行 —— 空行会让分块器切出一个孤立标题块
    expect(/\n\s*\n/.test(r.content)).toBe(false)
    expect(r.sourceStatus).toBe("QQ 群客服会话反思 #42")
  })

  it("正文已有句末标点时不重复补句号", () => {
    const r = renderUnit(unit({ body: "先关本地路由。" }), {
      chunkId: 1,
      date: "2026-09-16",
      rawSources: "",
    })
    expect(r.content).toContain("先关本地路由。来源：")
  })

  it("原文出现过的官方 URL 用作来源", () => {
    const url = "https://docs.packyapi.ai/docs/advanced/DeepSeekCodex.html"
    const r = renderUnit(unit({ sourceUrl: url }), {
      chunkId: 7,
      date: "2026-09-16",
      rawSources: `参照 ${url}`,
    })
    expect(r.sourceStatus).toBe(url)
    expect(r.content).toContain(`来源：${url}；`)
  })
})

describe("validateUnit / unitShapeIssue", () => {
  it("必填字段为空则拒绝", () => {
    expect(validateUnit(unit()).ok).toBe(true)
    expect(validateUnit(unit({ body: "   " })).ok).toBe(false)
    expect(validateUnit(unit({ task: "" })).ok).toBe(false)
  })

  it("含空行或超长都判为形状问题", () => {
    expect(unitShapeIssue("标题\n正文")).toBeNull()
    expect(unitShapeIssue("标题\n\n正文")).toContain("空行")
    expect(unitShapeIssue("x".repeat(501))).toContain("超长")
    expect(unitShapeIssue("x".repeat(500))).toBeNull()
  })

  it("MAX_MERGE_CHUNKS 是正整数常量", () => {
    expect(Number.isSafeInteger(MAX_MERGE_CHUNKS)).toBe(true)
    expect(MAX_MERGE_CHUNKS).toBeGreaterThan(0)
  })

  /**
   * unitShapeIssue 的长度阈值必须与真正落库用的分块器对齐:被放行的单元要是
   * 会被 splitCompactedFaq 硬切成两段,超长内容就以半句话的形态进向量库了。
   * 主题长度与模板文案挂钩,所以扫一段区间而不是钉死某个字数;末尾断言两侧
   * 都被覆盖,免得将来模板变长、窗口不再跨过边界时本测试静默退化成恒真。
   */
  it("放行的成文单元不会被共用分块器硬切", () => {
    let passed = 0
    let rejected = 0
    for (let n = 380; n <= 460; n++) {
      const { content } = renderUnit(unit({ body: "x".repeat(n) }), {
        chunkId: 1,
        date: "2026-09-16",
        rawSources: "",
      })
      if (unitShapeIssue(content) === null) {
        passed++
        expect(splitCompactedFaq(content)).toHaveLength(1)
      } else {
        rejected++
      }
    }
    expect(passed).toBeGreaterThan(0)
    expect(rejected).toBeGreaterThan(0)
  })
})

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

const entry = {
  id: 42,
  content: "Codex 加密内容报 400 时新建会话重试",
  question: "encrypted content could not be verified 怎么办",
  answer: "新建会话后重试",
}

const candidateDocs = [
  { doc: "retrieval/faq/api-errors.md", chunks: ["主题：API 401/403/404"] },
]

function composeDeps(structured: unknown) {
  return {
    entry,
    candidateDocs,
    queryFn: fakeQuery(structured) as never,
    queryTimeoutMs: 1000,
    now: () => Date.UTC(2026, 8, 16, 8, 0),
    exists: () => false,
  }
}

const goodDecision = {
  target: { mode: "merge", doc: "retrieval/faq/api-errors.md" },
  unit: {
    product: "Codex",
    protocol: "OpenAI Responses",
    task: "加密内容校验失败报 400",
    body: "新建会话后重试，沿用原任务 ID；仍失败则留取脱敏错误与 request id",
    sourceUrl: "",
    volatility: "错误文案随客户端版本变化",
  },
}

describe("composePromotion", () => {
  it("合规结果:merge 到候选文档并成文", async () => {
    const r = await composePromotion(composeDeps(goodDecision))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.doc).toBe("retrieval/faq/api-errors.md")
    expect(r.value.kind).toBe("merge")
    expect(r.value.content).toContain(
      "# 产品：Codex；协议：OpenAI Responses；任务：加密内容校验失败报 400"
    )
    expect(r.value.content).toContain(
      "来源：QQ 群客服会话反思 #42；核验日期：2026-09-16"
    )
    expect(r.value.sourceStatus).toBe("QQ 群客服会话反思 #42")
  })

  it("编造目标文档 → 拒绝本条", async () => {
    const r = await composePromotion(
      composeDeps({
        ...goodDecision,
        target: { mode: "merge", doc: "retrieval/faq/made-up.md" },
      })
    )
    expect(r.ok).toBe(false)
  })

  it("成文字段为空 → 拒绝本条", async () => {
    const r = await composePromotion(
      composeDeps({
        ...goodDecision,
        unit: { ...goodDecision.unit, body: "  " },
      })
    )
    expect(r.ok).toBe(false)
  })

  it("单元超长 → 拒绝本条(不写半成品)", async () => {
    const r = await composePromotion(
      composeDeps({
        ...goodDecision,
        unit: { ...goodDecision.unit, body: "长".repeat(600) },
      })
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain("超长")
  })

  it("无法解析输出 → 拒绝本条", async () => {
    const r = await composePromotion(composeDeps({ nope: true }))
    expect(r.ok).toBe(false)
  })

  it("new 分支:kind 透传且路径由白名单拼出", async () => {
    // 其余用例都走 merge,这条闭合 target.kind → value.kind 的透传,
    // 并证明 compose 层也真的会用 new 分支(resolveTarget 已在 Task 4 单测过)
    const r = await composePromotion(
      composeDeps({
        ...goodDecision,
        target: { mode: "new", domain: "faq", slug: "codex-encrypted-400" },
      })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.kind).toBe("new")
    expect(r.value.doc).toBe("retrieval/faq/codex-encrypted-400.md")
  })

  it("请求带上 json_schema outputFormat", async () => {
    let captured: { options?: { outputFormat?: unknown } } | undefined
    const qf = ((args: unknown) => {
      captured = args as { options?: { outputFormat?: unknown } }
      return fakeQuery(goodDecision)()
    }) as never
    await composePromotion({ ...composeDeps(goodDecision), queryFn: qf })
    expect(captured?.options?.outputFormat).toEqual({
      type: "json_schema",
      schema: COMPOSE_OUTPUT_SCHEMA,
    })
  })
})
