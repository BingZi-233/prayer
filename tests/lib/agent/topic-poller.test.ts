import { describe, it, expect, beforeEach, vi } from "vitest"
import { classifyItems, runScan } from "@/lib/agent/topic-poller"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { bus } from "@/lib/bus"

describe("classifyItems 校验", () => {
  const existing = new Set([1, 2])
  it("结构化优先:合法项对齐;越界/重复/缺 i 丢弃;幻觉 topicId 丢弃", () => {
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
    const out = classifyItems(structured, "", 4, existing)
    expect(out).toEqual([
      { i: 0, topicId: 1 },
      { i: 1, newTitle: "新主题" },
    ])
  })

  it("无结构化时回退文本解析", () => {
    const raw = '这是解释 {"items":[{"i":0,"topicId":2}]} 结尾'
    const out = classifyItems(undefined, raw, 1, existing)
    expect(out).toEqual([{ i: 0, topicId: 2 }])
  })

  it("解析失败 → 返回 null(调用方跳过、不推进游标)", () => {
    expect(classifyItems(undefined, "抱歉无法处理", 3, existing)).toBeNull()
  })

  it("structured 直接是数组时也能解析", () => {
    const out = classifyItems([{ i: 0, topicId: 1 }], "", 1, new Set([1]))
    expect(out).toEqual([{ i: 0, topicId: 1 }])
  })

  it("文本兜底解析裸数组", () => {
    const out = classifyItems(undefined, '前言 [{"i":0,"newTitle":"退款"}] 后语', 1, new Set([1]))
    expect(out).toEqual([{ i: 0, newTitle: "退款" }])
  })
})

const embed = async () => new Float32Array([1, 0, 0])
function seed(repo: Repo, groupId: number, userId: number, role: string | null, text: string, at: number) {
  ;(repo as any).db
    .prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
    .run(groupId, userId, role, text, at)
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
  adminGroupId: 999,
  enabledGroups: [100],
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
    expect(repo.topicCursor(100)).toBe(NOW - 4000) // 本批最大 created_at
  })

  it("noise 全丢 → 无 occurrence,游标仍推进", async () => {
    seed(repo, 100, 200, "member", "在吗", NOW - 5000)
    await runScan(opts(repo, { queryFn: fakeQuery([{ i: 0, noise: true }]) as never }))
    expect(repo.rankingByWindow(0)).toHaveLength(0)
    expect(repo.topicCursor(100)).toBe(NOW - 5000)
  })

  it("空窗口 → 游标推进到 now-settle(防 prune 卡死),不调 LLM", async () => {
    const qf = vi.fn(fakeQuery([]))
    await runScan(opts(repo, { queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.topicCursor(100)).toBe(NOW - 1000)
  })

  it("newTitle 与现有主题近义 → 归并到现有,不新建", async () => {
    // 归一化后仅差空格 → textNearlySame=true
    const t = repo.insertQuestionTopic("退款一般3个工作日到账", 0)
    seed(repo, 100, 200, "member", "退款多久", NOW - 5000)
    await runScan(
      opts(repo, {
        queryFn: fakeQuery([{ i: 0, newTitle: "退款一般 3 个工作日到账" }]) as never, // 仅差空格
      })
    )
    const rows = repo.rankingByWindow(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(t) // 归并到已有
  })

  it("LLM 畸形输出 → 不落库,游标不动(下轮重试)", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    await runScan(opts(repo, { queryFn: fakeQueryText("抱歉无法处理") as never }))
    expect(repo.rankingByWindow(0)).toHaveLength(0)
    expect(repo.topicCursor(100)).toBe(0)
  })

  it("非生效群跳过,不调 LLM,游标不动", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    const qf = vi.fn(fakeQuery([{ i: 0, newTitle: "x" }]))
    await runScan(opts(repo, { enabledGroups: [], queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.topicCursor(100)).toBe(0)
  })

  it("落库中途抛错 → 事务回滚,无 occurrence、游标不动,报 error.occurred", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    seed(repo, 100, 201, "member", "退款要多久", NOW - 4000)
    const orig = repo.insertQuestionOccurrence.bind(repo)
    let n = 0
    ;(repo as any).insertQuestionOccurrence = (...a: any[]) => {
      if (++n === 2) throw new Error("boom")
      return (orig as any)(...a)
    }
    const errs: unknown[] = []
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
    expect(repo.topicCursor(100)).toBe(0) // 游标未推进
    expect(errs.some((e) => (e as any).scope === "topic")).toBe(true)
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
    const row = (repo as any).db.prepare("SELECT updated_at FROM question_topics WHERE id=?").get(topicId) as {
      updated_at: number
    }
    expect(row.updated_at).toBe(NOW)
  })

  it("windowMax 截断 + 跨轮推进消化剩余", async () => {
    // seed 60 条递增 created_at 的 member 消息
    for (let i = 0; i < 60; i++) seed(repo, 100, 200 + i, "member", `问题${i}`, NOW - 60000 + i * 100)
    const topicId = repo.insertQuestionTopic("批量", 0)
    // items 生成 60 个都归到已存在 topic;classifyItems 按 batchLen 截断越界项,安全
    const items = Array.from({ length: 60 }, (_, i) => ({ i, topicId }))

    // 首轮:windowMax=50 → 落 50 条,游标=第 50 条 created_at
    await runScan(opts(repo, { windowMax: 50, queryFn: fakeQuery(items) as never }))
    expect(repo.rankingByWindow(0)).toEqual([expect.objectContaining({ id: topicId, count: 50 })])
    expect(repo.topicCursor(100)).toBe(NOW - 60000 + 49 * 100)

    // 第二轮:消化剩余 10 条,游标=第 60 条 created_at,总计 60
    await runScan(opts(repo, { windowMax: 50, queryFn: fakeQuery(items) as never }))
    expect(repo.rankingByWindow(0)).toEqual([expect.objectContaining({ id: topicId, count: 60 })])
    expect(repo.topicCursor(100)).toBe(NOW - 60000 + 59 * 100)
  })
})
