import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { bus } from "@/lib/bus"
import { assemble } from "@/lib/assemble"

beforeEach(() => bus.removeAllListeners())

describe("assemble e2e(总线级)", () => {
  it("@bot 群消息 → 经全链路 → 发出 action.send(channelized)", async () => {
    const repo = new Repo(openDb(":memory:"))
    const fakeAgent = {
      run: vi.fn(async () => ({ text: "已收到您的问题", sessionId: "s1" })),
    }
    assemble({
      repo,
      botQQ: 555,
      adminGroupId: 999,
      enabledGroups: [1],
      agent: fakeAgent as any,
      ackEnabled: false, // 测主答案,不测 ACK(意图门可能耗时)
    })

    const sent = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("message.received", {
      channel: "qq",
      chatId: "1",
      userId: "2",
      messageId: "1",
      rawText: "退货",
      atList: ["555"],
    })
    const a = await sent
    expect(a.channel).toBe("qq")
    expect(a.chatId).toBe("1")
    expect(a.text).toBe("已收到您的问题")
    expect(a).not.toHaveProperty("action")
  })

  it("proactiveEnabled 开关控制 poller 定时器:开启比关闭多挂一个,teardown 均清干净", () => {
    vi.useFakeTimers()
    try {
      const repo = new Repo(openDb(":memory:"))
      const fakeAgent = {
        run: vi.fn(async () => ({ text: "x", sessionId: "s" })),
      }
      const mk = (extra: Record<string, unknown> = {}) =>
        assemble({
          repo,
          botQQ: 555,
          adminGroupId: 999,
          enabledGroups: [1],
          agent: fakeAgent as any,
          ...extra,
        })

      const baseline = vi.getTimerCount()

      // 关闭(默认):reflection-poller + handoff 等,proactive 不额外多挂
      const off = mk()
      const disabledCount = vi.getTimerCount() - baseline
      off()
      expect(vi.getTimerCount()).toBe(baseline) // teardown 清干净

      // 开启:比关闭恰好多一个 poller 定时器
      const on = mk({ proactiveEnabled: true, proactiveScanMs: 999999 })
      const enabledCount = vi.getTimerCount() - baseline
      expect(enabledCount).toBe(disabledCount + 1)
      on()
      expect(vi.getTimerCount()).toBe(baseline) // teardown 全清
    } finally {
      vi.useRealTimers()
    }
  })
})
