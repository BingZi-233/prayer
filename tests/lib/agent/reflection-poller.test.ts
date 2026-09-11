import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { bus } from "@/lib/core/bus"
import {
  runScan,
  registerReflectionPoller,
  isDuplicateOfHits,
  textNearlySame,
  bigramJaccard,
  collectKbContext,
  itemsFromStructured,
  REFLECT_OUTPUT_SCHEMA,
} from "@/lib/agent/reflection-poller"
import type { ActionSend, ErrorOccurred } from "@/lib/events"
import type Database from "better-sqlite3"

/** Repo.db 是 private;测试需要直写 SQL 种子数据 */
const repoDb = (repo: Repo) => (repo as unknown as { db: Database.Database }).db
let repo: Repo
const embed = async () => new Float32Array([1, 0, 0]) // 与 openDb(:memory:,3) 一致

// 假 query:只返回 structured_output(SDK 强制路径)
function fakeQuery(structured?: unknown) {
  return async function* () {
    yield {
      type: "result",
      subtype: "success",
      ...(structured !== undefined ? { structured_output: structured } : {}),
    }
  }
}

function item(
  over: Partial<{
    question: string
    answer: string
    effective: boolean
    faq: string
  }> = {}
) {
  return {
    question: over.question ?? "q",
    answer: over.answer ?? "a",
    effective: over.effective ?? true,
    faq: over.faq ?? "faq",
  }
}

// 用固定 now 造时间带内消息:seedAt 相对 now 的偏移(ms,负数=更早)
function seed(
  groupId: number,
  userId: number,
  role: string,
  text: string,
  at: number
) {
  repoDb(repo)
    .prepare(
      "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
    )
    .run("qq", String(groupId), String(userId), role, text, at)
}

const NOW = 10_000_000
const opts = (over: Record<string, unknown> = {}) => ({
  repo,
  adminSurface: { channel: "qq" as const, chatId: "999" },
  embed,
  now: () => NOW,
  scanMs: 1, // 不用于 runScan
  lookbackMs: 1_000_000,
  settleMs: 1000,
  windowMax: 60,
  enabledChats: [{ channel: "qq" as const, chatId: "100" }],
  ...over,
})

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:", 3))
})

describe("itemsFromStructured(structured 优先 + 文本兜底)", () => {
  it("抽出有效 items;缺字段跳过", () => {
    expect(
      itemsFromStructured({
        items: [
          item({ question: "退款多久", answer: "3天", faq: "退款 3 天" }),
          { effective: true }, // 缺 faq
          { faq: "x" }, // 缺 effective
        ],
      })
    ).toEqual([
      {
        question: "退款多久",
        answer: "3天",
        effective: true,
        faq: "退款 3 天",
      },
    ])
  })
  it("无 structured 且无文本 → null", () => {
    expect(itemsFromStructured(undefined)).toBeNull()
    expect(itemsFromStructured(null)).toBeNull()
  })
  it("裸数组 structured 可解析", () => {
    expect(itemsFromStructured([{ effective: true, faq: "x" }])).toEqual([
      { question: "", answer: "", effective: true, faq: "x" },
    ])
  })
  it("文本 JSON 兜底", () => {
    expect(
      itemsFromStructured(
        undefined,
        `{"items":[{"effective":true,"faq":"从文本来","question":"q","answer":"a"}]}`
      )
    ).toEqual([
      {
        question: "q",
        answer: "a",
        effective: true,
        faq: "从文本来",
      },
    ])
  })
  it("空 items → []", () => {
    expect(itemsFromStructured({ items: [] })).toEqual([])
  })
})

describe("reflection-poller 去重 helpers", () => {
  it("textNearlySame / bigramJaccard 识别近义与包含", () => {
    expect(
      textNearlySame("退款一般 3 个工作日到账", "退款一般3个工作日到账")
    ).toBe(true)
    expect(
      textNearlySame("退款一般3个工作日到账", "说明:退款一般3个工作日到账。")
    ).toBe(true)
    expect(textNearlySame("退款多久", "如何改密码")).toBe(false)
    expect(bigramJaccard("abcdefgh", "abcdefgh")).toBe(1)
  })

  it("isDuplicateOfHits:文本重合或向量近且相关 → 重复", () => {
    const hits = [{ content: "退款一般3个工作日到账", distance: 0.1 }]
    expect(
      isDuplicateOfHits("退款一般 3 个工作日到账", hits, 0.45).duplicate
    ).toBe(true)
    expect(
      isDuplicateOfHits("如何修改登录密码步骤一打开设置", hits, 0.45).duplicate
    ).toBe(false)
    // 距离远但文本完全一致仍判重
    expect(
      isDuplicateOfHits(
        "退款一般3个工作日到账",
        [{ content: "退款一般3个工作日到账", distance: 9 }],
        0.45
      ).duplicate
    ).toBe(true)
  })
})

describe("reflection-poller runScan", () => {
  it("有效解答 → 入库 + 通知管理群 + 推进游标", async () => {
    // 已沉降带 (0, NOW-settle=9_999_000]
    seed(100, 200, "member", "退款多久到账?", NOW - 5000)
    seed(100, 201, "admin", "一般 3 个工作日", NOW - 4000)
    seed(100, 200, "member", "好的谢谢解决了", NOW - 3000)
    const notice = new Promise<ActionSend>((res) =>
      bus.once("action.send", res)
    )
    await runScan(
      opts({
        queryFn: fakeQuery({
          items: [
            item({
              question: "退款多久到账",
              answer: "3个工作日",
              faq: "退款一般 3 个工作日到账",
            }),
          ],
        }) as never,
      })
    )
    const a = await notice
    expect(a.channel).toBe("qq")
    expect(a.chatId).toBe("999")
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 1)
    expect(hits[0].content).toContain("退款")
    expect(hits[0].source).toContain("human-reflection:qq:100:")
    expect(repo.groupReflectCursor("qq", "100")).toBe(NOW - 1000) // until = now - settle
    // 落来源问答:reflectionEntries 带出 question/answer
    const entry = repo.reflectionEntries().find((r) => r.chatId === "100")!
    expect(entry).toMatchObject({
      question: "退款多久到账",
      answer: "3个工作日",
    })
  })

  it("query 带 outputFormat.json_schema", async () => {
    seed(100, 201, "admin", "答案", NOW - 4000)
    let captured: { options?: { outputFormat?: unknown } } | undefined
    const qf = (args: { options?: { outputFormat?: unknown } }) => {
      captured = args
      return fakeQuery({ items: [] })()
    }
    await runScan(opts({ queryFn: qf as never }))
    expect(captured?.options?.outputFormat).toEqual({
      type: "json_schema",
      schema: REFLECT_OUTPUT_SCHEMA,
    })
  })

  it("notifyAdmin=false → 入库但不通知管理群", async () => {
    seed(100, 200, "member", "退款多久到账?", NOW - 5000)
    seed(100, 201, "admin", "一般 3 个工作日", NOW - 4000)
    const spy = vi.fn()
    bus.on("action.send", spy)
    await runScan(
      opts({
        notifyAdmin: false,
        queryFn: fakeQuery({
          items: [
            item({
              question: "退款多久到账",
              answer: "3个工作日",
              faq: "退款一般 3 个工作日到账",
            }),
          ],
        }) as never,
      })
    )
    expect(spy).not.toHaveBeenCalled()
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(1)
    expect(repo.groupReflectCursor("qq", "100")).toBe(NOW - 1000)
  })

  it("effective=false → 不入库不通知,仍推进游标", async () => {
    seed(100, 201, "admin", "在的亲", NOW - 4000)
    const spy = vi.fn()
    bus.on("action.send", spy)
    await runScan(
      opts({
        queryFn: fakeQuery({
          items: [item({ effective: false, faq: "闲聊" })],
        }) as never,
      })
    )
    expect(spy).not.toHaveBeenCalled()
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0)
    expect(repo.groupReflectCursor("qq", "100")).toBe(NOW - 1000)
  })

  it("群内无管理发言 → 不成为候选,不调用 LLM,游标不动", async () => {
    seed(100, 200, "member", "只有用户发言", NOW - 4000)
    const qf = vi.fn(fakeQuery({ items: [] }))
    await runScan(opts({ queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.groupReflectCursor("qq", "100")).toBe(0)
  })

  it("太新(settle 带内)的管理发言不被处理", async () => {
    // at = NOW-500 > until(NOW-1000) → 不在已沉降带
    seed(100, 201, "admin", "刚说的", NOW - 500)
    const qf = vi.fn(fakeQuery({ items: [] }))
    await runScan(opts({ queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
  })

  it("无 structured 且无文本 → 不入库,游标不动(下轮重试)", async () => {
    seed(100, 201, "admin", "答案", NOW - 4000)
    await runScan(opts({ queryFn: fakeQuery(undefined) as never }))
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0)
    expect(repo.groupReflectCursor("qq", "100")).toBe(0)
  })

  it("无 structured 但文本 JSON 合法 → 入库并推进游标", async () => {
    seed(100, 200, "member", "怎么退款", NOW - 5000)
    seed(100, 201, "admin", "一般三天", NOW - 4000)
    await runScan(
      opts({
        queryFn: async function* () {
          yield {
            type: "assistant",
            message: {
              content: [
                {
                  type: "text",
                  text: `{"items":[{"question":"怎么退款","answer":"一般三天","effective":true,"faq":"退款一般三天到账"}]}`,
                },
              ],
            },
          }
          yield { type: "result", subtype: "success" }
        } as never,
      })
    )
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 5)
    expect(hits.some((h) => h.content.includes("退款一般三天"))).toBe(true)
    expect(repo.groupReflectCursor("qq", "100")).toBe(NOW - 1000)
  })

  it("空 items → 不入库,仍推进游标", async () => {
    seed(100, 201, "admin", "答案", NOW - 4000)
    await runScan(opts({ queryFn: fakeQuery({ items: [] }) as never }))
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0)
    expect(repo.groupReflectCursor("qq", "100")).toBe(NOW - 1000)
  })

  it("until <= 群游标 → 直接跳过(不重复处理)", async () => {
    repo.setGroupReflectCursor("qq", "100", NOW) // 该群游标已在 now,until=now-settle < cursor
    seed(100, 201, "admin", "答案", NOW - 4000)
    const qf = vi.fn(fakeQuery({ items: [] }))
    await runScan(opts({ queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.groupReflectCursor("qq", "100")).toBe(NOW) // 不动
  })

  it("忙群:band 管理发言在大量后续消息后仍入窗(不被 evict)", async () => {
    seed(100, 200, "member", "怎么退款?", NOW - 8000) // 问题
    seed(100, 201, "admin", "在我的订单页点退款", NOW - 7000) // 管理回答(band 内)
    for (let i = 0; i < 70; i++)
      seed(100, 300 + i, "member", `灌水${i}`, NOW - 6000 + i)
    let captured = ""
    const qf = (args: { prompt: string }) => {
      captured = args.prompt
      return fakeQuery({ items: [] })()
    }
    await runScan(opts({ queryFn: qf as never, windowMax: 60 }))
    expect(captured).toContain("在我的订单页点退款") // 回答必须出现在喂给 LLM 的转录里
    expect(captured).toContain("<EXISTING_KNOWLEDGE_JSONL>")
    expect(captured).toContain("<CHAT_RECORDS_JSONL>")
  })

  it("prompt 注入已有知识库片段,供 LLM 去重", async () => {
    repo.insertKbEntry(
      "faq/refund.md",
      "退款一般三个工作日到账",
      "faq/refund.md",
      new Float32Array([1, 0, 0])
    )
    seed(100, 200, "member", "退款多久?", NOW - 5000)
    seed(100, 201, "admin", "3 个工作日", NOW - 4000)
    let captured = ""
    const qf = (args: { prompt: string }) => {
      captured = args.prompt
      return fakeQuery({ items: [] })()
    }
    await runScan(opts({ queryFn: qf as never }))
    expect(captured).toContain("<EXISTING_KNOWLEDGE_JSONL>")
    expect(captured).toContain("退款一般三个工作日到账")
  })

  it("入库前硬去重:与已有知识库近义 → 不重复入库", async () => {
    repo.insertKbEntry(
      "faq/refund.md",
      "退款一般3个工作日到账",
      "faq/refund.md",
      new Float32Array([1, 0, 0])
    )
    seed(100, 200, "member", "退款多久?", NOW - 5000)
    seed(100, 201, "admin", "3 个工作日", NOW - 4000)
    const spy = vi.fn()
    bus.on("action.send", spy)
    await runScan(
      opts({
        queryFn: fakeQuery({
          items: [
            item({
              question: "退款多久",
              answer: "3天",
              faq: "退款一般 3 个工作日到账",
            }),
          ],
        }) as never,
      })
    )
    // 仅基础文档 1 条,无新增 human-reflection
    const refs = repo.reflectionEntries()
    expect(refs).toHaveLength(0)
    expect(spy).not.toHaveBeenCalled()
    expect(repo.groupReflectCursor("qq", "100")).toBe(NOW - 1000) // 仍推进
  })

  it("多群同 FAQ → 去重只沉淀 1 条", async () => {
    seed(100, 201, "admin", "群100答案", NOW - 4000)
    seed(200, 202, "admin", "群200答案", NOW - 4000)
    await runScan(
      opts({
        enabledChats: [
          { channel: "qq" as const, chatId: "100" },
          { channel: "qq" as const, chatId: "200" },
        ],
        queryFn: fakeQuery({
          items: [item({ question: "q", answer: "a", faq: "通用知识条" })],
        }) as never,
      })
    )
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 10)
    // 相同 FAQ 第二次被硬去重
    expect(hits.filter((h) => h.content === "通用知识条")).toHaveLength(1)
    expect(repo.groupReflectCursor("qq", "100")).toBe(NOW - 1000)
    expect(repo.groupReflectCursor("qq", "200")).toBe(NOW - 1000)
  })

  it("多群不同 FAQ → 各沉淀一条", async () => {
    seed(100, 201, "admin", "群100答案", NOW - 4000)
    seed(200, 202, "admin", "群200答案", NOW - 4000)
    const qf = (args: { prompt: string }) => {
      if (args.prompt.includes("群100答案")) {
        return fakeQuery({
          items: [
            item({
              question: "q1",
              answer: "a1",
              faq: "关于退款周期的说明是三个工作日",
            }),
          ],
        })()
      }
      return fakeQuery({
        items: [
          item({
            question: "q2",
            answer: "a2",
            faq: "修改密码请到设置页安全中心操作",
          }),
        ],
      })()
    }
    await runScan(
      opts({
        enabledChats: [
          { channel: "qq" as const, chatId: "100" },
          { channel: "qq" as const, chatId: "200" },
        ],
        queryFn: qf as never,
      })
    )
    const refs = repo.reflectionEntries()
    expect(refs).toHaveLength(2)
  })

  it("单群处理抛错 → 该群游标不推进(下轮重试),其他群照常沉淀", async () => {
    seed(100, 201, "admin", "群100答案", NOW - 4000)
    seed(200, 202, "admin", "群200答案", NOW - 4000)
    // 群100 转录触发抛错;群200 正常返回有效
    const qf = (args: { prompt: string }) => {
      if (args.prompt.includes("群100答案")) throw new Error("boom")
      return fakeQuery({
        items: [item({ question: "q", answer: "a", faq: "群200知识条" })],
      })()
    }
    const err = new Promise<ErrorOccurred>((res) =>
      bus.once("error.occurred", res)
    )
    await runScan(
      opts({
        enabledChats: [
          { channel: "qq" as const, chatId: "100" },
          { channel: "qq" as const, chatId: "200" },
        ],
        queryFn: qf as never,
      })
    )
    const e = await err
    expect(e.scope).toBe("reflection")
    expect(e.chatId).toBe("100")
    expect(e.channel).toBe("qq")
    expect(repo.groupReflectCursor("qq", "100")).toBe(0) // 抛错群不推进
    expect(repo.groupReflectCursor("qq", "200")).toBe(NOW - 1000) // 正常群推进
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 10)).toHaveLength(1) // 只群200沉淀
  })

  it("非生效群即使有已沉降管理发言也跳过,不调用 LLM,游标不动", async () => {
    seed(100, 200, "member", "退款多久?", NOW - 5000)
    seed(100, 201, "admin", "3 个工作日", NOW - 4000)
    const qf = vi.fn(fakeQuery({ items: [] }))
    await runScan(opts({ enabledChats: [], queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.groupReflectCursor("qq", "100")).toBe(0)
  })

  it("isBypassEnabled=false 时跳过该 chat，不调 LLM", async () => {
    repoDb(repo)
      .prepare(
        "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
      )
      .run("tg", "-1001", "200", "member", "退款多久?", NOW - 5000)
    repoDb(repo)
      .prepare(
        "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
      )
      .run("tg", "-1001", "201", "admin", "3 天", NOW - 4000)
    const qf = vi.fn(fakeQuery({ items: [] }))
    await runScan(
      opts({
        enabledChats: [{ channel: "tg" as const, chatId: "-1001" }],
        queryFn: qf as never,
        isBypassEnabled: () => false,
      })
    )
    expect(qf).not.toHaveBeenCalled()
    expect(repo.groupReflectCursor("tg", "-1001")).toBe(0)
  })

  it("防重入:上一轮扫描未结束时,下一 tick 跳过,不重复判定", async () => {
    vi.useFakeTimers()
    try {
      seed(100, 201, "admin", "答案", NOW - 4000)
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      // 卡在 gate 的慢 query:模拟单轮扫描耗时超过 scanMs
      const qf = vi.fn(() =>
        (async function* () {
          await gate
          yield {
            type: "result",
            subtype: "success",
            structured_output: { items: [] },
          }
        })()
      )
      const stop = registerReflectionPoller(
        opts({ scanMs: 1000, queryFn: qf as never })
      )
      await vi.advanceTimersByTimeAsync(1000) // tick1:启动扫描,卡在 gate
      expect(qf).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000) // tick2:running=true → 跳过
      expect(qf).toHaveBeenCalledTimes(1) // 无守卫时此处会变 2
      release()
      await vi.advanceTimersByTimeAsync(0) // flush:tick1 收尾,running=false
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("reflection-poller prune 下界协调(与 topicCursor)", () => {
  // NOW=10_000_000, lookbackMs=1_000_000, settleMs=1000(见 opts 默认)
  // → 未受 topic 侧约束时的反思 prune 阈值 = NOW - lookbackMs - settleMs = 8_999_000
  it("场景A:某群 topicCursor 小于反思阈值 → prune 下界被压低,阈值内消息不被删", async () => {
    repo.setTopicCursor("qq", "100", 8_000_000) // 小于反思阈值 8_999_000
    seed(100, 200, "member", "落在(topicCursor, 反思阈值)之间", 8_500_000)
    await runScan(opts({ queryFn: fakeQuery({ items: [] }) as never }))
    const rows = repoDb(repo)
      .prepare("SELECT created_at FROM group_messages WHERE group_id = '100'")
      .all() as { created_at: number }[]
    expect(rows).toHaveLength(1) // 未被删:prune 下界压到 topicCursor=8_000_000
  })

  it("场景B:无任何 topic 游标(全0)→ prune 行为与改动前一致,足够老的消息仍被删", async () => {
    seed(100, 200, "member", "足够老的消息", 8_000_000) // < 8_999_000 反思阈值
    seed(100, 200, "member", "较新的消息", 9_500_000) // > 8_999_000 反思阈值
    await runScan(opts({ queryFn: fakeQuery({ items: [] }) as never }))
    const rows = repoDb(repo)
      .prepare("SELECT created_at FROM group_messages WHERE group_id = '100'")
      .all() as { created_at: number }[]
    expect(rows.map((r) => r.created_at)).toEqual([9_500_000]) // 老消息已删,新消息保留
  })
})

describe("collectKbContext", () => {
  it("检索去重并按距离排序截断", async () => {
    repo.insertKbEntry(
      "a.md",
      "退款政策说明",
      "a.md",
      new Float32Array([1, 0, 0])
    )
    repo.insertKbEntry(
      "b.md",
      "密码重置流程",
      "b.md",
      new Float32Array([1, 0, 0])
    )
    const hits = await collectKbContext(repo, embed, ["退款多久", "退款"], 1)
    expect(hits).toHaveLength(1)
  })
})
