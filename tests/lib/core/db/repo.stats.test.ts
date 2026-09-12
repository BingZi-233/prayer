import { describe, it, expect } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"

function mkRepo(): Repo {
  return new Repo(openDb(":memory:", 3))
}

describe("Repo 统计/列表", () => {
  it("countSessions 计数", () => {
    const repo = mkRepo()
    expect(repo.countSessions()).toBe(0)
    repo.setSessionId("g1:u1", "s1")
    repo.setSessionId("g1:u2", "s2")
    expect(repo.countSessions()).toBe(2)
  })

  it("listSessions 返回 key/session_id/human_mode/updated_at", () => {
    const repo = mkRepo()
    repo.setSessionId("g1:u1", "s1")
    const list = repo.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0].key).toBe("g1:u1")
    expect(list[0].sessionId).toBe("s1")
    expect(list[0].humanMode).toBe(false)
  })

  it("openTickets 只返回 open", () => {
    const repo = mkRepo()
    repo.createTicket("g1:u1", "退款问题")
    const t = repo.openTickets()
    expect(t).toHaveLength(1)
    expect(t[0].sessionKey).toBe("g1:u1")
    expect(t[0].summary).toBe("退款问题")
  })

  it("listSessions 可据 humanMode 计数人工会话", () => {
    const repo = mkRepo()
    repo.setSessionId("g1:u1", "s1")
    repo.setSessionId("g1:u2", "s2")
    ;(repo as unknown as { db: import("better-sqlite3").Database }).db
      .prepare("UPDATE sessions SET human_mode = 1 WHERE key = ?")
      .run("g1:u1")
    expect(repo.listSessions().filter((s) => s.humanMode).length).toBe(1)
  })

  it("proactive 回复:插入 → 总数/每群计数/最近列表", () => {
    const repo = mkRepo()
    expect(repo.proactiveTotalCount()).toBe(0)
    expect(repo.proactiveReplies(10)).toHaveLength(0)
    expect(repo.proactiveGroupCounts()).toHaveLength(0)

    repo.insertProactiveReply("qq", "100", "200", "价格?", "cc 组 20 美元")
    repo.insertProactiveReply("qq", "100", "201", "限流?", "看分组")
    repo.insertProactiveReply("qq", "101", "202", "接入?", "填 base_url")

    expect(repo.proactiveTotalCount()).toBe(3)

    const counts = repo
      .proactiveGroupCounts()
      .sort((a, b) => a.chatId.localeCompare(b.chatId))
    expect(counts).toHaveLength(2)
    expect(counts[0]).toMatchObject({
      channel: "qq",
      chatId: "100",
      count: 2,
    })
    expect(counts[1]).toMatchObject({
      channel: "qq",
      chatId: "101",
      count: 1,
    })
    expect(counts[0].lastTs).toBeGreaterThan(0)

    const recent = repo.proactiveReplies(2)
    expect(recent).toHaveLength(2)
    // 降序:最新(101/接入)在前
    expect(recent[0]).toMatchObject({
      channel: "qq",
      chatId: "101",
      userId: "202",
      question: "接入?",
      answer: "填 base_url",
    })
  })

  it("只把已送达的主动回复计入成功指标", () => {
    const repo = mkRepo()
    repo.insertProactiveReply("qq", "pending", "u", "q", "a", {
      deliveryKey: "proactive-pending",
      deliveryStatus: "pending",
    })
    repo.insertProactiveReply("qq", "sent", "u", "q", "a", {
      deliveryKey: "proactive-sent",
      deliveryStatus: "sent",
    })

    expect(repo.proactiveTotalCount()).toBe(1)
    expect(repo.proactiveGroupCounts()).toEqual([
      expect.objectContaining({ channel: "qq", chatId: "sent", count: 1 }),
    ])
  })

  it("delivery 状态单调：已送达不会被迟到失败或重新计划覆盖", () => {
    const repo = mkRepo()
    repo.insertResolution("auto", {
      deliveryKey: "resolution-monotonic",
      deliveryStatus: "pending",
    })

    repo.markDelivery("resolution-monotonic", "sent", undefined, 10, 1)
    repo.markDelivery("resolution-monotonic", "failed", "late", 11, 1)
    repo.planDelivery("resolution-monotonic", 2)

    expect(repo.resolutionCounts(0).auto).toBe(1)
  })
})

describe("Repo 工具调用日表", () => {
  it("addToolStatsDaily 幂等累加", () => {
    const repo = mkRepo()
    repo.addToolStatsDaily("2026-09-01", "agent", [
      { tool: "kb_search", runs: 1, calls: 2 },
      { tool: "__run__", runs: 1, calls: 2 },
    ])
    repo.addToolStatsDaily("2026-09-01", "agent", [
      { tool: "kb_search", runs: 1, calls: 1 },
      { tool: "__run__", runs: 1, calls: 1 },
    ])
    const rows = repo.toolStatsDaily("2026-09-01")
    expect(rows.find((r) => r.tool === "kb_search")).toMatchObject({
      runs: 2,
      calls: 3,
    })
    expect(rows.find((r) => r.tool === "__run__")).toMatchObject({
      runs: 2,
      calls: 3,
    })
  })

  it("toolStatsDaily 只返回当天", () => {
    const repo = mkRepo()
    repo.addToolStatsDaily("2026-09-01", "agent", [
      { tool: "__run__", runs: 1, calls: 0 },
    ])
    repo.addToolStatsDaily("2026-09-02", "agent", [
      { tool: "__run__", runs: 1, calls: 0 },
    ])
    expect(repo.toolStatsDaily("2026-09-01")).toHaveLength(1)
  })

  it("空行数组不写库", () => {
    const repo = mkRepo()
    repo.addToolStatsDaily("2026-09-01", "agent", [])
    expect(repo.toolStatsDaily("2026-09-01")).toHaveLength(0)
  })

  it("新库迁移到 v5 且表已建", () => {
    const db = openDb(":memory:", 3)
    expect(
      Number(db.pragma("user_version", { simple: true }))
    ).toBeGreaterThanOrEqual(5)
    const row = db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='tool_stats_daily'"
      )
      .get()
    expect(row).toBeTruthy()
  })
})
