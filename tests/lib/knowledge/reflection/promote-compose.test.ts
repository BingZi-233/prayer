import { describe, it, expect } from "vitest"
import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  COMPOSE_FIELD_MAX,
  COMPOSE_OUTPUT_SCHEMA,
  composeBodyBudget,
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
import {
  DEFAULT_KB_CHUNK_MAX_CHARS,
  splitCompactedFaq,
} from "@/lib/knowledge/reflection/compact-chunks"

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

describe("composeBodyBudget", () => {
  /** 四个短字段顶满 maxLength、正文顶满预算、来源取 sourceUrl 时的渲染结果 */
  const worstRender = (
    opts: { chunkId: number; date: string; rawSources: string },
    sourceUrl: string,
    bodyChar = "正"
  ) =>
    renderUnit(
      {
        product: "P".repeat(COMPOSE_FIELD_MAX.product),
        protocol: "R".repeat(COMPOSE_FIELD_MAX.protocol),
        task: "T".repeat(COMPOSE_FIELD_MAX.task),
        // 正文不以句末标点结尾,渲染时会补一个「。」,这是最坏情况
        body: bodyChar.repeat(composeBodyBudget(opts)),
        sourceUrl,
        volatility: "V".repeat(COMPOSE_FIELD_MAX.volatility),
      },
      opts
    ).content

  it("最坏字段 + 预算正文 + 会话来源标注渲染后不超上限且恰好顶满", () => {
    for (const chunkId of [1, 42, 333321, 9_999_999_999]) {
      const opts = { chunkId, date: "2026-10-25", rawSources: "" }
      const content = worstRender(opts, "")
      expect(content.length).toBe(DEFAULT_KB_CHUNK_MAX_CHARS)
      expect(unitShapeIssue(content)).toBeNull()
      expect(splitCompactedFaq(content)).toHaveLength(1)
    }
    expect(
      composeBodyBudget({ chunkId: 333321, date: "2026-10-25", rawSources: "" })
    ).toBeGreaterThan(250)
  })

  it("来源原文里的最长可信 URL 计入最坏来源行", () => {
    const longUrl = `https://www.packyapi.ai/${"a".repeat(80)}`
    const rawSources = `见 ${longUrl}。另见 https://x.cn/b`
    const opts = { chunkId: 1, date: "2026-10-25", rawSources }
    const base = composeBodyBudget({ ...opts, rawSources: "" })
    const withUrl = composeBodyBudget(opts)
    expect(withUrl).toBeLessThan(base)
    // 模型取最长 URL 作来源时也不超
    const content = worstRender(opts, longUrl)
    expect(content).toContain(`来源：${longUrl}；`)
    expect(content.length).toBe(DEFAULT_KB_CHUNK_MAX_CHARS)
    // 取较短 URL 或退回会话标注时更不会超
    expect(worstRender(opts, "https://x.cn/b").length).toBeLessThan(
      DEFAULT_KB_CHUNK_MAX_CHARS
    )
    expect(worstRender(opts, "").length).toBeLessThan(
      DEFAULT_KB_CHUNK_MAX_CHARS
    )
  })

  it("短 URL 不比会话来源标注长时不缩小预算", () => {
    const opts = { chunkId: 42, date: "2026-10-25", rawSources: "" }
    expect(composeBodyBudget({ ...opts, rawSources: "见 https://x.cn" })).toBe(
      composeBodyBudget(opts)
    )
  })

  it("schema 四个短字段带固定 maxLength", () => {
    const props = COMPOSE_OUTPUT_SCHEMA.properties.unit.properties
    expect(props.product.maxLength).toBe(COMPOSE_FIELD_MAX.product)
    expect(props.protocol.maxLength).toBe(COMPOSE_FIELD_MAX.protocol)
    expect(props.task.maxLength).toBe(COMPOSE_FIELD_MAX.task)
    expect(props.volatility.maxLength).toBe(COMPOSE_FIELD_MAX.volatility)
  })
})

function fakeQuery(
  structured: unknown,
  support: unknown = { supported: true, reason: "来源支持" }
) {
  return (args?: {
    options?: {
      outputFormat?: { schema?: { properties?: Record<string, unknown> } }
    }
  }) =>
    (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "" }] },
      }
      yield {
        type: "result",
        subtype: "success",
        structured_output: args?.options?.outputFormat?.schema?.properties
          ?.supported
          ? support
          : structured,
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
  it("成文新增原文未支持的否定限制时拒绝升格", async () => {
    const decision = {
      ...goodDecision,
      unit: {
        ...goodDecision.unit,
        body: "可导出 Markdown；该操作仅针对单条笔记，不涉及批量导出与跨设备同步",
      },
    }
    let verificationPrompt = ""
    let verificationSystem = ""
    const controllers: AbortController[] = []
    const queryFn = (args: {
      prompt: string
      options: {
        systemPrompt: string
        abortController: AbortController
        outputFormat: { schema: unknown }
      }
    }) => {
      controllers.push(args.options.abortController)
      if (args.options.outputFormat.schema !== COMPOSE_OUTPUT_SCHEMA) {
        verificationPrompt = args.prompt
        verificationSystem = args.options.systemPrompt
      }
      return fakeQuery(decision, {
        supported: false,
        reason: "无直接来源的适用范围限制",
      })(args as never)
    }
    const result = await composePromotion({
      ...composeDeps(decision),
      entry: {
        id: 42,
        content: "纸舟笔记可以在笔记菜单导出 Markdown",
        question: null,
        answer: null,
      },
      queryFn: queryFn as never,
    })
    expect(result).toEqual({
      ok: false,
      reason: "成文含来源未支持的事实或限制,保留原条目",
    })
    expect(verificationPrompt).toContain("<SOURCE_JSON>")
    expect(verificationPrompt).toContain("不涉及批量导出与跨设备同步")
    expect(verificationSystem).toContain("来源没有提及不等于")
    expect(controllers).toHaveLength(2)
    expect(controllers.every((controller) => controller.signal.aborted)).toBe(
      true
    )
  })

  it("来源核验输出非法时保留反思,不当作默认通过", async () => {
    const result = await composePromotion({
      ...composeDeps(goodDecision),
      queryFn: fakeQuery(goodDecision, {
        supported: "true",
        reason: "",
      }) as never,
    })
    expect(result).toEqual({
      ok: false,
      reason: "无法解析成文来源核验结果,保留原条目",
    })
  })

  it("来源核验超时会取消查询且不返回可提交的单元", async () => {
    let verificationController: AbortController | undefined
    const queryFn = (args: {
      options: {
        outputFormat: { schema: unknown }
        abortController: AbortController
      }
    }) => {
      if (args.options.outputFormat.schema === COMPOSE_OUTPUT_SCHEMA)
        return fakeQuery(goodDecision)(args as never)
      verificationController = args.options.abortController
      return (async function* () {
        await new Promise<void>((resolve) =>
          verificationController!.signal.addEventListener(
            "abort",
            () => resolve(),
            { once: true }
          )
        )
        yield { type: "result", subtype: "success" }
      })()
    }
    await expect(
      composePromotion({
        ...composeDeps(goodDecision),
        queryFn: queryFn as never,
        queryTimeoutMs: 10,
      })
    ).rejects.toThrow("超时(10ms)")
    expect(verificationController?.signal.aborted).toBe(true)
  })

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

  it("请求向模型给出可用域名和 schema,结束后释放查询", async () => {
    let captured:
      | {
          options?: {
            outputFormat?: unknown
            systemPrompt?: string
            abortController?: AbortController
          }
        }
      | undefined
    const qf = ((args: unknown) => {
      const input = args as {
        options?: { outputFormat?: { schema?: unknown } }
      }
      if (input.options?.outputFormat?.schema === COMPOSE_OUTPUT_SCHEMA)
        captured = args as typeof captured
      return fakeQuery(goodDecision)(args as never)
    }) as never
    await composePromotion({ ...composeDeps(goodDecision), queryFn: qf })
    expect(captured?.options?.outputFormat).toEqual({
      type: "json_schema",
      schema: COMPOSE_OUTPUT_SCHEMA,
    })
    expect(
      COMPOSE_OUTPUT_SCHEMA.properties.target.properties.domain.enum
    ).toEqual(RETRIEVAL_DOMAINS)
    for (const domain of RETRIEVAL_DOMAINS)
      expect(captured?.options?.systemPrompt).toContain(domain)
    expect(captured?.options?.abortController?.signal.aborted).toBe(true)
  })

  it("成文超时会取消 SDK 查询", async () => {
    let controller: AbortController | undefined
    const queryFn = ((args: {
      options: { abortController: AbortController }
    }) => {
      controller = args.options.abortController
      return (async function* () {
        await new Promise<void>((resolve) => {
          controller!.signal.addEventListener("abort", () => resolve(), {
            once: true,
          })
        })
        yield { type: "result", subtype: "success" }
      })()
    }) as never
    await expect(
      composePromotion({
        ...composeDeps(goodDecision),
        queryFn,
        queryTimeoutMs: 10,
      })
    ).rejects.toThrow("超时(10ms)")
    expect(controller?.signal.aborted).toBe(true)
  })

  describe("正文预算与超长重试", () => {
    type Call = { prompt: string; systemPrompt: string; compose: boolean }
    /** 成文调用依次返回 decisions 里的结果(用完后重复最后一个),核验恒通过 */
    function scripted(decisions: unknown[]) {
      const calls: Call[] = []
      let i = 0
      const queryFn = (args: {
        prompt: string
        options: { systemPrompt: string; outputFormat: { schema: unknown } }
      }) => {
        const compose =
          args.options.outputFormat.schema === COMPOSE_OUTPUT_SCHEMA
        calls.push({
          prompt: args.prompt,
          systemPrompt: args.options.systemPrompt,
          compose,
        })
        const decision = compose
          ? decisions[Math.min(i++, decisions.length - 1)]
          : null
        return fakeQuery(decision)(args as never)
      }
      return { calls, queryFn: queryFn as never }
    }
    const withBody = (body: string) => ({
      ...goodDecision,
      unit: { ...goodDecision.unit, body },
    })
    const date = "2026-09-16"

    it("首版超长、重试合规 → 成功,重试提示写明超出字数", async () => {
      const { calls, queryFn } = scripted([
        withBody("长".repeat(600)),
        goodDecision,
      ])
      const r = await composePromotion({
        ...composeDeps(goodDecision),
        queryFn,
      })
      expect(r.ok).toBe(true)
      const compose = calls.filter((c) => c.compose)
      expect(compose).toHaveLength(2)
      // 超出字数按首版真实渲染结果实算
      const overflow =
        renderUnit(withBody("长".repeat(600)).unit, {
          chunkId: entry.id,
          date,
          rawSources: [entry.content, entry.question, entry.answer].join("\n"),
        }).content.length - DEFAULT_KB_CHUNK_MAX_CHARS
      expect(overflow).toBeGreaterThan(0)
      expect(compose[0].prompt).not.toContain("超出")
      expect(compose[1].prompt).toContain(`超出上限 ${overflow} 字符`)
      // 核验只对合规的第二版调用一次
      expect(calls.filter((c) => !c.compose)).toHaveLength(1)
    })

    it("两次都超长 → 单元超长失败,成文调用 2 次且不调用核验", async () => {
      const { calls, queryFn } = scripted([withBody("长".repeat(600))])
      const r = await composePromotion({
        ...composeDeps(goodDecision),
        queryFn,
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toMatch(/^单元超长\(\d+ > 500\)$/)
      expect(calls.filter((c) => c.compose)).toHaveLength(2)
      expect(calls.filter((c) => !c.compose)).toHaveLength(0)
    })

    it("非超长失败不重试", async () => {
      const { calls, queryFn } = scripted([
        { ...goodDecision, target: { mode: "merge", doc: "retrieval/x/y.md" } },
      ])
      const r = await composePromotion({
        ...composeDeps(goodDecision),
        queryFn,
      })
      expect(r.ok).toBe(false)
      expect(calls).toHaveLength(1)
    })

    it("正文空行被折叠,不再报单元含空行", async () => {
      const { calls, queryFn } = scripted([
        withBody("第一步新建会话\n\n  \n第二步重试"),
      ])
      const r = await composePromotion({
        ...composeDeps(goodDecision),
        queryFn,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(/\n\s*\n/.test(r.value.content)).toBe(false)
      expect(r.value.content).toContain("第一步新建会话\n第二步重试")
      expect(calls.filter((c) => c.compose)).toHaveLength(1)
    })

    it("系统提示对不同条目逐字恒定,预算只进 user prompt", async () => {
      const a = scripted([goodDecision])
      await composePromotion({
        ...composeDeps(goodDecision),
        queryFn: a.queryFn,
      })
      const longUrl = `https://docs.packyapi.ai/${"z".repeat(60)}`
      const otherEntry = {
        id: 987654,
        content: `另一条反思,见 ${longUrl}`,
        question: "别的问题",
        answer: null,
      }
      const b = scripted([goodDecision])
      await composePromotion({
        ...composeDeps(goodDecision),
        entry: otherEntry,
        queryFn: b.queryFn,
      })
      const sysA = a.calls.find((c) => c.compose)!.systemPrompt
      const sysB = b.calls.find((c) => c.compose)!.systemPrompt
      expect(sysA).toBe(sysB)

      const budgetA = composeBodyBudget({
        chunkId: entry.id,
        date,
        rawSources: [entry.content, entry.question, entry.answer].join("\n"),
      })
      const budgetB = composeBodyBudget({
        chunkId: otherEntry.id,
        date,
        rawSources: [otherEntry.content, otherEntry.question, ""].join("\n"),
      })
      expect(budgetA).not.toBe(budgetB)
      expect(a.calls.find((c) => c.compose)!.prompt).toContain(
        `正文 body 不超过 ${budgetA} 字符`
      )
      expect(b.calls.find((c) => c.compose)!.prompt).toContain(
        `正文 body 不超过 ${budgetB} 字符`
      )
      expect(sysA).not.toContain(String(budgetA))
      expect(sysA).not.toContain(String(budgetB))
    })
  })
})
