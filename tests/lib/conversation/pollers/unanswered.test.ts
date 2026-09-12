import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { bus } from "@/lib/core/bus"
import { SessionStore } from "@/lib/conversation/session"
import { runScan } from "@/lib/conversation/pollers/unanswered"
import { AGENT_FALLBACK_TEXT } from "@/lib/conversation/agent"
import type { ErrorOccurred, ReplyReady } from "@/lib/core/chat/events"
import type Database from "better-sqlite3"

/** Repo.db 是 private;测试需要直写 SQL 种子数据 */
const repoDb = (repo: Repo) => (repo as unknown as { db: Database.Database }).db
let repo: Repo
const NOW = 10_000_000

function seed(
  groupId: number,
  userId: number,
  role: string | null,
  text: string,
  at: number,
  messageId?: number
) {
  repoDb(repo)
    .prepare(
      "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at,message_id) VALUES (?,?,?,?,?,?,?)"
    )
    .run(
      "qq",
      String(groupId),
      String(userId),
      role,
      text,
      at,
      messageId != null ? String(messageId) : null
    )
}

// 假 agent:返回固定文本 + sessionId
const fakeAgent = (text: string, sessionId = "sess-x") => ({
  run: vi.fn(async () => ({ text, sessionId })),
})

const base = (over: Record<string, unknown> = {}) => ({
  repo,
  store: new SessionStore(repo, 0),
  classify: async () => ({ decision: "answerable" as const }), // 默认判官放行
  adminSurface: { channel: "qq" as const, chatId: "999" },
  enabledChats: [{ channel: "qq" as const, chatId: "100" }],
  silenceMs: 1000, // until = NOW-1000
  maxPerScan: 2,
  now: () => NOW,
  agent: fakeAgent("这是答案") as never,
  ...over,
})

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:"))
})

describe("unanswered poller runScan", () => {
  it("happy path:沉降未应答问题 → 发 reply + 写回 session + 推进游标", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1) // 非冷启动
    seed(100, 200, "member", "claude 价格?", NOW - 5000)
    const agent = fakeAgent("cc 组每百万 token 20 美元", "sess-1")
    const reply = new Promise<ReplyReady>((res) => bus.once("reply.ready", res))
    await runScan(base({ agent: agent as never }))
    const r = await reply
    expect(r.channel).toBe("qq")
    expect(r.chatId).toBe("100")
    expect(r.text).toContain("20 美元")
    expect(agent.run).toHaveBeenCalledTimes(1)
    expect(repo.sessionUpdatedAt("qq:100:200")).toBeGreaterThan(0) // remember 写回
    expect(repo.groupProactiveCursor("qq", "100")).toBe(NOW - 1000)
    // 命中留痕:库里 1 条,内容为问题原料 + agent 答案
    expect(repo.proactiveTotalCount()).toBe(1)
    const rec = repo.proactiveReplies(10)
    expect(rec[0]).toMatchObject({
      channel: "qq" as const,
      chatId: "100",
      userId: "200",
      question: "claude 价格?",
      answer: "cc 组每百万 token 20 美元",
    })
  })

  it("主动回复引用用户代表消息(band 内最后一条)", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "第一句", NOW - 6000, 501)
    seed(100, 200, "member", "第二句?", NOW - 5000, 502) // band 内最后一条 → 代表
    const reply = new Promise<ReplyReady>((res) => bus.once("reply.ready", res))
    await runScan(base())
    const r = await reply
    expect(r.replyToId).toBe("502")
  })

  it("沉默(哨兵/空/降级)不写库", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "价格?", NOW - 5000)
    await runScan(base({ agent: fakeAgent("__NO_ANSWER__") as never }))
    expect(repo.proactiveTotalCount()).toBe(0)
  })

  it("冷启动(游标==0):设为 until 并跳过,不答积压", async () => {
    seed(100, 200, "member", "价格?", NOW - 5000)
    const agent = fakeAgent("答案")
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: agent as never }))
    expect(agent.run).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
    expect(repo.groupProactiveCursor("qq", "100")).toBe(NOW - 1000)
  })

  it("压制①人工接管:问题后有 admin 发言 → 沉默", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "价格?", NOW - 5000)
    seed(100, 201, "admin", "cc 组 20 美元", NOW - 4000)
    const agent = fakeAgent("答案")
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: agent as never }))
    expect(agent.run).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
  })

  it("压制②主链路已处理:session.updated_at > 问题 ts → 沉默", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "价格?", NOW - 5000)
    repo.setSessionId("qq:100:200", "已 @处理") // updated_at ≈ 真实 now >> 问题 ts
    const agent = fakeAgent("答案")
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: agent as never }))
    expect(agent.run).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
  })

  it("@bot 消息不作补位候选(归主链路处理,不抢答)", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    repoDb(repo)
      .prepare(
        "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at,message_id,mentioned_bot) VALUES (?,?,?,?,?,?,?,1)"
      )
      .run("qq", "100", "200", "member", "价格?", NOW - 5000, "601")
    const agent = fakeAgent("答案")
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: agent as never }))
    expect(agent.run).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
  })

  it("门1 判官=false → 不进 agent、不发", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "今天天气?", NOW - 5000)
    const agent = fakeAgent("答案")
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(
      base({
        agent: agent as never,
        classify: async () => ({ decision: "not_answerable" as const }),
      })
    )
    expect(agent.run).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
  })

  it("哨兵:agent 输出 __NO_ANSWER__ → 沉默、不写回 session", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "冷门问题?", NOW - 5000)
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: fakeAgent("__NO_ANSWER__") as never }))
    expect(spy).not.toHaveBeenCalled()
    expect(repo.sessionUpdatedAt("qq:100:200")).toBeUndefined()
  })

  it("主动路径不 resume 已有主会话(防哨兵污染 transcript)", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "价格?", NOW - 5000)
    repo.setSessionId("qq:100:200", "sid-main")
    // 压制②靠 session.updated_at > questionTs;把 updated_at 拨回问题之前以便放行
    repoDb(repo)
      .prepare("UPDATE sessions SET updated_at = ? WHERE key = ?")
      .run(NOW - 6000, "qq:100:200")
    const agent = fakeAgent("答案", "sess-proactive")
    await runScan(base({ agent: agent as never }))
    expect(agent.run).toHaveBeenCalledWith(
      expect.stringContaining("【主动模式】"),
      undefined, // 不传 resumeId
      expect.objectContaining({ sessionKey: "qq:100:200" })
    )
  })

  it("agent 空输出 → 沉默", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "问题?", NOW - 5000)
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: fakeAgent("   ") as never }))
    expect(spy).not.toHaveBeenCalled()
  })

  it("agent 降级兜底文案(非抛错)→ 沉默、不写回 session", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "问题?", NOW - 5000)
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: fakeAgent(AGENT_FALLBACK_TEXT) as never }))
    expect(spy).not.toHaveBeenCalled()
    expect(repo.sessionUpdatedAt("qq:100:200")).toBeUndefined()
  })

  it("agent partial/failed → 保持游标不动,不把部分文本当答案", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "问题?", NOW - 5000)
    const agent = {
      run: vi.fn(async () => ({
        text: "部分答案",
        sessionId: "partial",
        status: "partial" as const,
      })),
    }
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: agent as never }))
    expect(spy).not.toHaveBeenCalled()
    expect(repo.groupProactiveCursor("qq", "100")).toBe(1)
  })

  it("太新(> until)消息不处理", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "刚问的", NOW - 500) // > until = NOW-1000
    const agent = fakeAgent("答案")
    await runScan(base({ agent: agent as never }))
    expect(agent.run).not.toHaveBeenCalled()
  })

  it("maxPerScan:每群每轮命中不超过上限", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "问题A", NOW - 5000)
    seed(100, 201, "member", "问题B", NOW - 4900)
    seed(100, 202, "member", "问题C", NOW - 4800)
    const agent = fakeAgent("答案")
    await runScan(base({ agent: agent as never, maxPerScan: 2 }))
    expect(agent.run).toHaveBeenCalledTimes(2)
  })

  it("非生效群:即使有沉降提问也跳过", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "价格?", NOW - 5000)
    const agent = fakeAgent("答案")
    await runScan(base({ agent: agent as never, enabledChats: [] }))
    expect(agent.run).not.toHaveBeenCalled()
  })

  it("命中 maxPerScan 上限 → 不推进游标(溢出下轮再答,不丢弃)", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "问题A", NOW - 5000)
    seed(100, 201, "member", "问题B", NOW - 4900)
    seed(100, 202, "member", "问题C", NOW - 4800)
    await runScan(base({ agent: fakeAgent("答案") as never, maxPerScan: 2 }))
    expect(repo.groupProactiveCursor("qq", "100")).toBe(1) // 未推进
  })

  it("全部候选被压制 → 无 reply,但游标仍推进(不重复扫)", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "价格?", NOW - 5000)
    seed(100, 201, "admin", "已答", NOW - 4000) // 压制①
    const spy = vi.fn()
    bus.on("reply.ready", spy)
    await runScan(base({ agent: fakeAgent("答案") as never }))
    expect(spy).not.toHaveBeenCalled()
    expect(repo.groupProactiveCursor("qq", "100")).toBe(NOW - 1000) // 推进
  })

  it("单群抛错 → emit error.occurred(scope=proactive),不炸整轮", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "价格?", NOW - 5000)
    const boom = {
      run: vi.fn(async () => {
        throw new Error("boom")
      }),
    }
    const err = new Promise<ErrorOccurred>((res) =>
      bus.once("error.occurred", res)
    )
    await runScan(base({ agent: boom as never }))
    const e = await err
    expect(e.scope).toBe("proactive")
    expect(e.chatId).toBe("100")
    expect(e.channel).toBe("qq")
  })

  it("判官 error → 保持游标不动,下轮可重试", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "价格?", NOW - 5000)
    await runScan(
      base({
        classify: async () => ({
          decision: "error" as const,
          reason: "classifier_error" as const,
        }),
      })
    )
    expect(repo.groupProactiveCursor("qq", "100")).toBe(1)
  })

  it("连续不可答候选达到预算 → 停止并保持游标", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1)
    seed(100, 200, "member", "问题A", NOW - 5000)
    seed(100, 201, "member", "问题B", NOW - 4900)
    seed(100, 202, "member", "问题C", NOW - 4800)
    seed(100, 203, "member", "问题D", NOW - 4700)
    const classify = vi.fn(async () => ({ decision: "not_answerable" as const }))
    await runScan(base({ classify, maxCandidatesPerScan: 3 }))
    expect(classify).toHaveBeenCalledTimes(3)
    expect(repo.groupProactiveCursor("qq", "100")).toBe(1)
  })

  it("isBypassEnabled=false 时跳过该 chat，不调 agent", async () => {
    repoDb(repo)
      .prepare(
        "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
      )
      .run("tg", "-1001", "200", "member", "价格?", NOW - 5000)
    repo.setGroupProactiveCursor("tg", "-1001", 1)
    const agent = fakeAgent("答案")
    await runScan(
      base({
        agent: agent as never,
        enabledChats: [{ channel: "tg" as const, chatId: "-1001" }],
        isBypassEnabled: () => false,
      })
    )
    expect(agent.run).not.toHaveBeenCalled()
    expect(repo.groupProactiveCursor("tg", "-1001")).toBe(1)
  })
})
