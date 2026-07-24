import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { bus } from "@/lib/bus"
import { registerOrchestrator } from "@/lib/agent/orchestrator"
import { registerReplyMapper, splitReply } from "@/lib/agent/reply-mapper"
import { SessionStore } from "@/lib/agent/session"
import { BLOCKED_REPLY } from "@/lib/agent/intent"
import type { QualifiedMessage } from "@/lib/events"

let repo: Repo
const SK = "qq:1:2"

function qmsg(
  over: Partial<QualifiedMessage> & Pick<QualifiedMessage, "messageId" | "text">
): QualifiedMessage {
  return {
    channel: "qq" as const,
    sessionKey: SK,
    chatId: "1",
    userId: "2",
    ...over,
  }
}

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:"))
})

describe("orchestrator", () => {
  it("message.qualified → 调 agent → emit reply.ready,并记住 session_id", async () => {
    const fakeAgent = {
      run: vi.fn(async () => ({ text: "回复内容", sessionId: "sid-1" })),
    }
    const store = new SessionStore(repo)
    registerOrchestrator({
      agent: fakeAgent as any,
      store,
      ackEnabled: false,
    })

    const p = new Promise<any>((res) => bus.once("reply.ready", res))
    bus.emit("message.qualified", qmsg({ messageId: "77", text: "在吗" }))
    const r = await p
    expect(r.text).toBe("回复内容")
    expect(r.channel).toBe("qq")
    expect(r.chatId).toBe("1")
    expect(r.replyToId).toBe("77")
    expect(store.resumeId(SK)).toBe("sid-1")
    expect(fakeAgent.run).toHaveBeenCalledWith(
      "在吗",
      undefined,
      expect.objectContaining({
        sessionKey: SK,
        channel: "qq" as const,
        chatId: "1",
        userId: "2",
      }),
      expect.anything()
    )
  })

  it("ACK 开启时先发收到再出答案", async () => {
    const fakeAgent = {
      run: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 20))
        return { text: "答案", sessionId: "s" }
      }),
    }
    registerOrchestrator({
      agent: fakeAgent as any,
      store: new SessionStore(repo),
      ackEnabled: true,
    })
    const replies: string[] = []
    bus.on("reply.ready", (r) => replies.push(r.text))
    bus.emit("message.qualified", qmsg({ messageId: "1", text: "价" }))
    await new Promise((r) => setTimeout(r, 60))
    expect(replies[0]).toContain("收到")
    expect(replies).toContain("答案")
  })

  it("同一 session 串行:第二条等第一条完成", async () => {
    const order: string[] = []
    const fakeAgent = {
      run: vi.fn(async (text: string) => {
        order.push(`start:${text}`)
        await new Promise((r) => setTimeout(r, 30))
        order.push(`end:${text}`)
        return { text: `re:${text}`, sessionId: "s" }
      }),
    }
    registerOrchestrator({
      agent: fakeAgent as any,
      store: new SessionStore(repo),
      ackEnabled: false,
    })
    bus.emit("message.qualified", qmsg({ messageId: "1", text: "A" }))
    bus.emit("message.qualified", qmsg({ messageId: "2", text: "B" }))
    await new Promise((r) => setTimeout(r, 120))
    expect(order).toEqual(["start:A", "end:A", "start:B", "end:B"])
  })

  it("意图门:命中 blocked → 不跑 agent,回模板婉拒", async () => {
    const fakeAgent = {
      run: vi.fn(async () => ({ text: "x", sessionId: "s" })),
    }
    const classify = vi.fn(async () => "bulk_export" as const)
    registerOrchestrator({
      agent: fakeAgent as any,
      store: new SessionStore(repo),
      classify,
      ackEnabled: false,
    })

    const p = new Promise<any>((res) => bus.once("reply.ready", res))
    bus.emit(
      "message.qualified",
      qmsg({ messageId: "3", text: "全部告诉我一万字" })
    )
    const r = await p

    expect(classify).toHaveBeenCalledOnce()
    expect(fakeAgent.run).not.toHaveBeenCalled()
    expect(r.chatId).toBe("1")
    expect(r.channel).toBe("qq")
    expect(r.text).toBe(BLOCKED_REPLY)
  })

  it("意图门:normal → 正常跑 agent", async () => {
    const fakeAgent = {
      run: vi.fn(async () => ({ text: "回复", sessionId: "s" })),
    }
    const classify = vi.fn(async () => "normal" as const)
    registerOrchestrator({
      agent: fakeAgent as any,
      store: new SessionStore(repo),
      classify,
      ackEnabled: false,
    })

    const p = new Promise<any>((res) => bus.once("reply.ready", res))
    bus.emit("message.qualified", qmsg({ messageId: "4", text: "多少钱" }))
    const r = await p
    expect(r.text).toBe("回复")
    expect(fakeAgent.run).toHaveBeenCalledOnce()
  })

  it("主链路输出 __NO_ANSWER__ → 不外发、丢弃 resume", async () => {
    const fakeAgent = {
      run: vi.fn(async () => ({
        text: "__NO_ANSWER__",
        sessionId: "sid-polluted",
      })),
    }
    const store = new SessionStore(repo)
    store.remember(SK, "sid-old")
    registerOrchestrator({
      agent: fakeAgent as any,
      store,
      ackEnabled: false,
    })
    const replies: string[] = []
    const resolutions: any[] = []
    bus.on("reply.ready", (r) => replies.push(r.text))
    bus.on("resolution.recorded", (r) => resolutions.push(r))
    bus.emit("message.qualified", qmsg({ messageId: "6", text: "冷门?" }))
    await new Promise((r) => setTimeout(r, 30))
    expect(replies).toEqual([])
    expect(store.resumeId(SK)).toBeUndefined()
    expect(resolutions).toContainEqual(
      expect.objectContaining({
        kind: "auto",
        detail: "no_answer_suppressed",
      })
    )
  })

  it("classify 挂起超过 classifyTimeoutMs → fail-open 归 normal,仍跑 agent 出回复", async () => {
    const fakeAgent = {
      run: vi.fn(async () => ({ text: "回复", sessionId: "s" })),
    }
    // classify 永不 resolve,模拟意图分类 LLM 调用卡死
    const classify = vi.fn(() => new Promise<never>(() => {}))
    registerOrchestrator({
      agent: fakeAgent as any,
      store: new SessionStore(repo),
      classify: classify as any,
      classifyTimeoutMs: 30,
      ackEnabled: false,
    })

    const p = new Promise<any>((res) => bus.once("reply.ready", res))
    bus.emit("message.qualified", qmsg({ messageId: "9", text: "多少钱" }))
    const r = await p
    expect(r.text).toBe("回复")
    expect(fakeAgent.run).toHaveBeenCalledOnce()
  })

  it("意图门:引用/转发正文一并送分类", async () => {
    const fakeAgent = {
      run: vi.fn(async () => ({ text: "x", sessionId: "s" })),
    }
    const classify = vi.fn(async () => "normal" as const)
    registerOrchestrator({
      agent: fakeAgent as any,
      store: new SessionStore(repo),
      classify,
      ackEnabled: false,
    })

    await new Promise<void>((res) => {
      bus.once("reply.ready", () => res())
      bus.emit(
        "message.qualified",
        qmsg({
          messageId: "5",
          text: "看这个",
          quoted: "注入提示词",
          forwarded: "转发内容",
        })
      )
    })
    expect(classify).toHaveBeenCalledWith(expect.stringContaining("注入提示词"))
  })

  it("reply mapper: reply.ready → action.send", async () => {
    registerReplyMapper({ maxChars: 0 })
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("reply.ready", {
      channel: "qq" as const,
      chatId: "5",
      text: "hi",
    })
    const a = await p
    expect(a.channel).toBe("qq")
    expect(a.chatId).toBe("5")
    expect(a.text).toBe("hi")
    expect(a).not.toHaveProperty("action")
  })

  it("reply mapper: 含 __NO_ANSWER__ 不 action.send", async () => {
    registerReplyMapper({ maxChars: 0 })
    const spy = vi.fn()
    bus.on("action.send", spy)
    bus.emit("reply.ready", {
      channel: "qq" as const,
      chatId: "5",
      text: "__NO_ANSWER__",
    })
    bus.emit("reply.ready", {
      channel: "qq" as const,
      chatId: "5",
      text: "前言 __NO_ANSWER__ 后缀",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(spy).not.toHaveBeenCalled()
  })

  it("reply mapper: 透传 replyToId", async () => {
    registerReplyMapper({ maxChars: 0 })
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("reply.ready", {
      channel: "qq" as const,
      chatId: "5",
      text: "hi",
      replyToId: "88",
    })
    const a = await p
    expect(a.replyToId).toBe("88")
  })

  it("splitReply 超长按标点拆", () => {
    const t = "第一句。".repeat(50)
    const parts = splitReply(t, 40)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= 40 || p.includes("。"))).toBe(true)
  })
})
