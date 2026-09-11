import { describe, it, expect, beforeEach, vi } from "vitest"
import { classifyItems, runScan } from "@/lib/agent/topic-poller"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { bus } from "@/lib/core/bus"
import type { ErrorOccurred } from "@/lib/core/chat/events"
import type Database from "better-sqlite3"

/** Repo.db 是 private;测试需要直写 SQL 种子数据 */
const repoDb = (repo: Repo) => (repo as unknown as { db: Database.Database }).db
describe("classifyItems 业务对齐(structured 优先 + 文本兜底)", () => {
  const existing = new Set([1, 2])
  it("合法项对齐;越界/重复/缺 i 丢弃;幻觉 topicId 丢弃", () => {
    const structured = {
      items: [
        { i: 0, topicId: 1 }, // 归入已有
        { i: 1, newTitle: "新主题" }, // 新建
        { i: 2, noise: true }, // 噪声丢弃
        { i: 3, topicId: 99 }, // 幻觉 id → 丢弃
        { i: 1, topicId: 2 }, // 重复 i → 丢弃
        { i: 9, topicId: 1 }, // 越界 → 丢弃
        { topicId: 1 }, // 缺 i → 丢弃
      ],
    }
    const out = classifyItems(structured, 4, existing)
    expect(out).toEqual([
      { i: 0, topicId: 1 },
      { i: 1, newTitle: "新主题" },
    ])
  })

  it("无 structured 且无文本 → null", () => {
    expect(classifyItems(undefined, 3, existing)).toBeNull()
    expect(classifyItems(null, 3, existing)).toBeNull()
  })

  it("裸数组 structured 可解析", () => {
    expect(classifyItems([{ i: 0, topicId: 1 }], 1, new Set([1]))).toEqual([
      { i: 0, topicId: 1 },
    ])
  })

  it("structured 非法形状 → null(无文本)", () => {
    expect(classifyItems({ nope: true }, 1, existing)).toBeNull()
  })

  it("无 structured 时文本 JSON 兜底", () => {
    const text = `{"items":[{"i":0,"topicId":1},{"i":1,"newTitle":"退款"}]}`
    expect(classifyItems(undefined, 2, existing, text)).toEqual([
      { i: 0, topicId: 1 },
      { i: 1, newTitle: "退款" },
    ])
  })

  it("多轮拼接文本取最后一个 items", () => {
    const text =
      `{"items":[{"i":0,"topicId":1}]}` +
      `{"items":[{"i":0,"newTitle":"最终"}]}`
    expect(classifyItems(undefined, 1, existing, text)).toEqual([
      { i: 0, newTitle: "最终" },
    ])
  })

  it("structured 优先于文本", () => {
    const text = `{"items":[{"i":0,"newTitle":"文本侧"}]}`
    const structured = { items: [{ i: 0, topicId: 1 }] }
    expect(classifyItems(structured, 1, existing, text)).toEqual([
      { i: 0, topicId: 1 },
    ])
  })
})

const embed = async () => new Float32Array([1, 0, 0])
function seed(
  repo: Repo,
  groupId: number,
  userId: number,
  role: string | null,
  text: string,
  at: number
) {
  repoDb(repo)
    .prepare(
      "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
    )
    .run("qq", String(groupId), String(userId), role, text, at)
}
// 假 query:返回带 structured 的 result(仿 drainQuery 消费形状)
function fakeQuery(items: unknown[]) {
  return async function* () {
    yield {
      type: "result",
      subtype: "success",
      structured_output: { items },
    }
  }
}
// 返回纯文本的假 query(畸形输出用)
function fakeQueryText(text: string) {
  return async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text }] } }
    yield { type: "result", subtype: "success" }
  }
}
const NOW = 10_000_000
const opts = (repo: Repo, over: Record<string, unknown> = {}) => ({
  repo,
  enabledChats: [{ channel: "qq" as const, chatId: "100" }],
  embed,
  now: () => NOW,
  scanMs: 1,
  settleMs: 1000,
  windowMax: 50,
  topicPromptMax: 40,
  ...over,
})

describe("topic-poller runScan", () => {
  let repo: Repo
  beforeEach(() => {
    bus.removeAllListeners()
    repo = new Repo(openDb(":memory:", 3))
  })

  it("member/NULL role 提问被归主题落库并推进游标", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    seed(repo, 100, 201, null, "退款要多久", NOW - 4000) // NULL role 也纳入
    seed(repo, 100, 202, "admin", "客服发言不计", NOW - 3000) // 客服排除
    await runScan(
      opts(repo, {
        queryFn: fakeQuery([
          { i: 0, newTitle: "退款相关" },
          { i: 1, topicId: -1 }, // 首轮无现有主题 → 幻觉 id 丢弃
        ]) as never,
      })
    )
    const rows = repo.rankingByWindow(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: "退款相关", count: 1 })
    expect(repo.topicCursor("qq", "100")).toBe(NOW - 4000) // 本批最大 created_at
  })

  it("noise 全丢 → 无 occurrence,游标仍推进", async () => {
    seed(repo, 100, 200, "member", "在吗", NOW - 5000)
    await runScan(
      opts(repo, { queryFn: fakeQuery([{ i: 0, noise: true }]) as never })
    )
    expect(repo.rankingByWindow(0)).toHaveLength(0)
    expect(repo.topicCursor("qq", "100")).toBe(NOW - 5000)
  })

  it("空窗口 → 游标推进到 now-settle(防 prune 卡死),不调 LLM", async () => {
    const qf = vi.fn(fakeQuery([]))
    await runScan(opts(repo, { queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.topicCursor("qq", "100")).toBe(NOW - 1000)
  })

  it("newTitle 与现有主题近义 → 归并到现有,不新建", async () => {
    // 归一化后仅差空格 → textNearlySame=true
    const t = repo.insertQuestionTopic("退款一般3个工作日到账", 0)
    seed(repo, 100, 200, "member", "退款多久", NOW - 5000)
    await runScan(
      opts(repo, {
        queryFn: fakeQuery([
          { i: 0, newTitle: "退款一般 3 个工作日到账" },
        ]) as never, // 仅差空格
      })
    )
    const rows = repo.rankingByWindow(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(t) // 归并到已有
  })

  it("同批多条近义 newTitle → 归并同一主题,不重复新建", async () => {
    seed(repo, 100, 200, "member", "退款多久到账", NOW - 5000)
    seed(repo, 100, 201, "member", "退款要几天", NOW - 4000)
    await runScan(
      opts(repo, {
        queryFn: fakeQuery([
          { i: 0, newTitle: "退款到账时间" },
          { i: 1, newTitle: "退款到账时间" }, // 完全同名 → insertQuestionTopic 复用
          { i: 2, newTitle: "退款 到账 时间" }, // 仅差空格,近义 → 批内归并
        ]) as never,
      })
    )
    const rows = repo.rankingByWindow(0)
    expect(rows).toHaveLength(1) // 只一个主题
    expect(rows[0].count).toBe(2) // 两条落库(i=2 越界丢弃)
  })

  it("近义老主题掉出 LLM 提示窗口(topicPromptMax)仍归并,不重复新建", async () => {
    // 先塞 topicPromptMax 个新主题把目标主题挤出提示窗口(mergePool 仍含它)
    const target = repo.insertQuestionTopic("退款到账时间", 0)
    for (let i = 0; i < 3; i++)
      repo.insertQuestionTopic(`占位主题${i}`, NOW - i) // 更晚活跃,排前
    seed(repo, 100, 200, "member", "退款多久", NOW - 5000)
    await runScan(
      opts(repo, {
        topicPromptMax: 2, // 目标主题(updated_at=0)落在前 2 之外
        queryFn: fakeQuery([{ i: 0, newTitle: "退款 到账 时间" }]) as never, // 近义
      })
    )
    const rows = repo.rankingByWindow(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(target) // 归并到窗口外老主题
  })

  it("无 structured 且文本非 JSON → 不落库,游标不动(下轮重试)", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    await runScan(
      opts(repo, { queryFn: fakeQueryText("抱歉无法处理") as never })
    )
    expect(repo.rankingByWindow(0)).toHaveLength(0)
    expect(repo.topicCursor("qq", "100")).toBe(0)
  })

  it("无 structured 但文本 JSON 合法 → 落库并推进游标", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    await runScan(
      opts(repo, {
        queryFn: fakeQueryText(
          `{"items":[{"i":0,"newTitle":"退款相关"}]}`
        ) as never,
      })
    )
    const rows = repo.rankingByWindow(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("退款相关")
    expect(repo.topicCursor("qq", "100")).toBe(NOW - 5000)
  })

  it("非生效群跳过,不调 LLM,游标不动", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    const qf = vi.fn(fakeQuery([{ i: 0, newTitle: "x" }]))
    await runScan(opts(repo, { enabledChats: [], queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.topicCursor("qq", "100")).toBe(0)
  })

  it("落库中途抛错 → 事务回滚,无 occurrence、游标不动,报 error.occurred", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    seed(repo, 100, 201, "member", "退款要多久", NOW - 4000)
    const orig = repo.insertQuestionOccurrence.bind(repo)
    let n = 0
    type InsertOcc = Repo["insertQuestionOccurrence"]
    ;(
      repo as unknown as { insertQuestionOccurrence: InsertOcc }
    ).insertQuestionOccurrence = (...a: Parameters<InsertOcc>) => {
      if (++n === 2) throw new Error("boom")
      return orig(...a)
    }
    const errs: ErrorOccurred[] = []
    bus.on("error.occurred", (e) => errs.push(e))
    await runScan(
      opts(repo, {
        queryFn: fakeQuery([
          { i: 0, newTitle: "退款相关" },
          { i: 1, newTitle: "退款到账时间" },
        ]) as never,
      })
    )
    expect(repo.rankingByWindow(0)).toHaveLength(0) // 事务回滚:第 1 条也没落
    expect(repo.topicCursor("qq", "100")).toBe(0) // 游标未推进
    expect(errs.some((e) => e.scope === "topic")).toBe(true)
  })

  it("命中已有 topicId → 刷新 updated_at,保持热门主题留在前排", async () => {
    const topicId = repo.insertQuestionTopic("老主题", 0)
    seed(repo, 100, 200, "member", "老主题相关提问", NOW - 5000)
    await runScan(
      opts(repo, {
        queryFn: fakeQuery([{ i: 0, topicId }]) as never,
      })
    )
    expect(repo.questionTopics()[0].id).toBe(topicId)
    const row = repoDb(repo)
      .prepare("SELECT updated_at FROM question_topics WHERE id=?")
      .get(topicId) as {
      updated_at: number
    }
    expect(row.updated_at).toBe(NOW)
  })

  it("windowMax 截断 + 跨轮推进消化剩余", async () => {
    // seed 60 条递增 created_at 的 member 消息
    for (let i = 0; i < 60; i++)
      seed(repo, 100, 200 + i, "member", `问题${i}`, NOW - 60000 + i * 100)
    const topicId = repo.insertQuestionTopic("批量", 0)
    // items 生成 60 个都归到已存在 topic;classifyItems 按 batchLen 截断越界项,安全
    const items = Array.from({ length: 60 }, (_, i) => ({ i, topicId }))

    // 首轮:windowMax=50 → 落 50 条,游标=第 50 条 created_at
    await runScan(
      opts(repo, { windowMax: 50, queryFn: fakeQuery(items) as never })
    )
    expect(repo.rankingByWindow(0)).toEqual([
      expect.objectContaining({ id: topicId, count: 50 }),
    ])
    expect(repo.topicCursor("qq", "100")).toBe(NOW - 60000 + 49 * 100)

    // 第二轮:消化剩余 10 条,游标=第 60 条 created_at,总计 60
    await runScan(
      opts(repo, { windowMax: 50, queryFn: fakeQuery(items) as never })
    )
    expect(repo.rankingByWindow(0)).toEqual([
      expect.objectContaining({ id: topicId, count: 60 }),
    ])
    expect(repo.topicCursor("qq", "100")).toBe(NOW - 60000 + 59 * 100)
  })

  it("isBypassEnabled=false 时跳过该 chat，不调 LLM", async () => {
    repoDb(repo)
      .prepare(
        "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
      )
      .run("tg", "-1001", "200", "member", "怎么退款", NOW - 5000)
    const qf = vi.fn(fakeQuery([{ i: 0, newTitle: "x" }]))
    await runScan(
      opts(repo, {
        enabledChats: [{ channel: "tg" as const, chatId: "-1001" }],
        queryFn: qf as never,
        isBypassEnabled: () => false,
      })
    )
    expect(qf).not.toHaveBeenCalled()
    expect(repo.topicCursor("tg", "-1001")).toBe(0)
  })

  it("送 LLM 的 prompt 已剔除敏感词(DB 原文保留)", async () => {
    seed(repo, 100, 200, "member", "更换分组得翻墙是不是", NOW - 5000)
    seed(repo, 100, 201, "member", "fq也算敏感词", NOW - 4000)
    let seenPrompt = ""
    const qf = vi.fn(async function* (args: { prompt: string }) {
      seenPrompt = args.prompt
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          items: [
            { i: 0, noise: true },
            { i: 1, noise: true },
          ],
        },
      }
    })
    await runScan(opts(repo, { queryFn: qf as never }))
    expect(qf).toHaveBeenCalled()
    expect(seenPrompt).toContain("[网络]")
    expect(seenPrompt).not.toMatch(/翻墙/)
    expect(seenPrompt).not.toMatch(/(?<![a-zA-Z0-9])fq(?![a-zA-Z0-9])/i)
    // 落库 occurrence 若有应是原文;本批 noise 无 occurrence,查 group_messages 仍是原文
    const raw = repoDb(repo)
      .prepare("SELECT text FROM group_messages WHERE group_id=? ORDER BY id")
      .all("100") as { text: string }[]
    expect(raw.map((r) => r.text)).toEqual([
      "更换分组得翻墙是不是",
      "fq也算敏感词",
    ])
  })

  it("new_sensitive 错误 → 跳过本批推进游标,不卡死、不回用户", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    seed(repo, 100, 201, "member", "退款多久", NOW - 4000)
    const errs: ErrorOccurred[] = []
    const sends: unknown[] = []
    bus.on("error.occurred", (e) => errs.push(e))
    bus.on("action.send", (a) => sends.push(a))
    await runScan(
      opts(repo, {
        queryFn: async function* () {
          throw new Error(
            "Claude Code returned an error result: API Error: 500 input new_sensitive (1026)"
          )
        } as never,
      })
    )
    // 游标推进到本批最大 created_at,下轮不再重试同一批
    expect(repo.topicCursor("qq", "100")).toBe(NOW - 4000)
    expect(repo.rankingByWindow(0)).toHaveLength(0)
    // 不发 error.occurred(避免 error-handler 向整群丢「系统繁忙」)
    expect(errs.filter((e) => e.scope === "topic")).toHaveLength(0)
    expect(sends).toHaveLength(0)
  })
})
