import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { bus } from "@/lib/bus"
import { registerGateway, isAtTrigger } from "@/lib/agent/gateway"
import type { IncomingMessage, QualifiedMessage } from "@/lib/events"

let repo: Repo
const BOT = "555"
const ADMIN = "888"
const SK = "qq:1:2"

function qqMsg(
  over: Partial<IncomingMessage> &
    Pick<IncomingMessage, "messageId" | "rawText">
): IncomingMessage {
  return {
    channel: "qq" as const,
    chatId: "1",
    userId: "2",
    atList: [BOT],
    ...over,
  }
}

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:"))
  registerGateway({
    repo,
    botQQ: 555,
    extraAtQQs: [888],
    adminSurface: { channel: "qq" as const, chatId: "999" },
    enabledChats: [{ channel: "qq" as const, chatId: "1" }],
    supportUrl: "https://example.com",
  })
})

function collectQualified(): Promise<QualifiedMessage> {
  return new Promise((res) => bus.once("message.qualified", res))
}

describe("isAtTrigger", () => {
  it("命中 botQQ", () => {
    expect(isAtTrigger([BOT], BOT, [])).toBe(true)
  })
  it("命中 extraAtQQs", () => {
    expect(isAtTrigger([ADMIN], BOT, [ADMIN])).toBe(true)
  })
  it("都不命中", () => {
    expect(isAtTrigger(["123"], BOT, [ADMIN])).toBe(false)
  })
  it("忽略 0 / 负数", () => {
    expect(isAtTrigger(["0"], BOT, ["0", "-1"])).toBe(false)
  })
})

describe("gateway", () => {
  it("@bot 的群消息 → emit message.qualified,含 sessionKey 与文本", async () => {
    const p = collectQualified()
    bus.emit(
      "message.received",
      qqMsg({ messageId: "10", rawText: "订单在哪", atList: [BOT] })
    )
    const q = await p
    expect(q.sessionKey).toBe(SK)
    expect(q.channel).toBe("qq")
    expect(q.chatId).toBe("1")
    expect(q.userId).toBe("2")
    expect(q.text).toBe("订单在哪")
    expect(q.messageId).toBe("10")
  })

  it("@额外监听 QQ(群管理)也当作 bot 触发", async () => {
    const p = collectQualified()
    bus.emit(
      "message.received",
      qqMsg({ messageId: "102", rawText: "帮我看看", atList: [ADMIN] })
    )
    const q = await p
    expect(q.sessionKey).toBe(SK)
    expect(q.text).toBe("帮我看看")
  })

  it("写入 lastQuestion 供会话列表预览", async () => {
    const p = collectQualified()
    bus.emit(
      "message.received",
      qqMsg({ messageId: "101", rawText: "多少钱", atList: [BOT] })
    )
    await p
    const s = repo.listSessions().find((x) => x.key === SK)
    expect(s?.lastQuestion).toBe("多少钱")
  })

  it("纯图消息(无文本)@bot 也放行,并透传 images/quoted/forwarded", async () => {
    const p = collectQualified()
    bus.emit(
      "message.received",
      qqMsg({
        messageId: "40",
        rawText: "",
        atList: [BOT],
        images: [{ data: "AAAA", mediaType: "image/png" }],
        quoted: "张三: 原问题",
        forwarded: "A: x",
      })
    )
    const q = await p
    expect(q.text).toBe("")
    expect(q.images).toEqual([{ data: "AAAA", mediaType: "image/png" }])
    expect(q.quoted).toBe("张三: 原问题")
    expect(q.forwarded).toBe("A: x")
  })

  it("未 @bot 不触发", async () => {
    const spy = vi.fn()
    bus.on("message.qualified", spy)
    bus.emit(
      "message.received",
      qqMsg({ messageId: "11", rawText: "闲聊", atList: [] })
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(spy).not.toHaveBeenCalled()
  })

  it("重复 message_id 只触发一次", async () => {
    const spy = vi.fn()
    bus.on("message.qualified", spy)
    const msg = qqMsg({ messageId: "12", rawText: "x", atList: [BOT] })
    bus.emit("message.received", msg)
    bus.emit("message.received", msg)
    await new Promise((r) => setTimeout(r, 50))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("用户自助重置:@bot 发关键词 → 清 resumeId、回确认、不转 Agent", async () => {
    repo.setSessionId(SK, "sid-old")
    const qualified = vi.fn()
    bus.on("message.qualified", qualified)
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit(
      "message.received",
      qqMsg({ messageId: "20", rawText: "重新开始", atList: [BOT] })
    )
    const a = await p
    expect(a.channel).toBe("qq")
    expect(a.chatId).toBe("1")
    expect(a.text).toContain("重置")
    expect(a.replyToId).toBe("20")
    expect(repo.getResumeId(SK)).toBeUndefined()
    expect(repo.getSessionId(SK)).toBe("sid-old")
    expect(qualified).not.toHaveBeenCalled()
  })

  it("普通问题不被重置关键词误伤", async () => {
    const p = collectQualified()
    bus.emit(
      "message.received",
      qqMsg({ messageId: "21", rawText: "怎么重置密码", atList: [BOT] })
    )
    const q = await p
    expect(q.text).toBe("怎么重置密码")
  })

  it("@bot 人工 → handoff.requested(含 channel)", async () => {
    const p = new Promise<any>((res) => bus.once("handoff.requested", res))
    bus.emit(
      "message.received",
      qqMsg({ messageId: "50", rawText: "人工", atList: [BOT] })
    )
    const h = await p
    expect(h.sessionKey).toBe(SK)
    expect(h.channel).toBe("qq")
    expect(h.chatId).toBe("1")
  })

  it("TG 人工关键词 + 有 adminSurface → emit handoff.requested", async () => {
    bus.removeAllListeners()
    registerGateway({
      repo,
      botQQ: 555,
      adminSurface: { channel: "qq" as const, chatId: "999" },
      enabledChats: [
        { channel: "qq" as const, chatId: "1" },
        { channel: "tg" as const, chatId: "-1001" },
      ],
      supportUrl: "https://example.com",
    })
    const p = new Promise<any>((res) => bus.once("handoff.requested", res))
    bus.emit("message.received", {
      channel: "tg" as const,
      chatId: "-1001",
      userId: "42",
      messageId: "9",
      rawText: "人工",
      atList: [],
      botMentioned: true,
    })
    const h = await p
    expect(h.channel).toBe("tg")
    expect(h.chatId).toBe("-1001")
    expect(h.sessionKey).toBe("tg:-1001:42")
  })

  it("无 adminSurface 时人工关键词 → 引导官网,不 emit handoff", async () => {
    bus.removeAllListeners()
    registerGateway({
      repo,
      botQQ: 555,
      adminSurface: null,
      enabledChats: [{ channel: "tg" as const, chatId: "-1001" }],
      supportUrl: "https://example.com",
    })
    const handoff = vi.fn()
    bus.on("handoff.requested", handoff)
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("message.received", {
      channel: "tg" as const,
      chatId: "-1001",
      userId: "42",
      messageId: "10",
      rawText: "人工",
      atList: [],
      botMentioned: true,
    })
    const a = await p
    expect(a.channel).toBe("tg")
    expect(a.chatId).toBe("-1001")
    expect(a.text).toMatch(/支持|客服|example\.com/)
    expect(handoff).not.toHaveBeenCalled()
  })

  it("human-mode 会话丢弃 qualified", async () => {
    repo.setHumanMode(SK, true)
    const spy = vi.fn()
    bus.on("message.qualified", spy)
    bus.emit(
      "message.received",
      qqMsg({ messageId: "51", rawText: "还在吗", atList: [BOT] })
    )
    await new Promise((r) => setTimeout(r, 30))
    expect(spy).not.toHaveBeenCalled()
  })

  it("管理群 !reset <key> → 清 resumeId 并回确认", async () => {
    repo.setSessionId(SK, "sid-old")
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("message.received", {
      channel: "qq" as const,
      chatId: "999",
      userId: "7",
      messageId: "22",
      rawText: `!reset ${SK}`,
      atList: [BOT],
    })
    const a = await p
    expect(a.channel).toBe("qq")
    expect(a.chatId).toBe("999")
    expect(a.text).toContain(SK)
    expect(repo.getResumeId(SK)).toBeUndefined()
    expect(repo.getSessionId(SK)).toBe("sid-old")
  })

  it("管理群 !resume <key> → handoff.resumed", async () => {
    const p = new Promise<any>((res) => bus.once("handoff.resumed", res))
    bus.emit("message.received", {
      channel: "qq" as const,
      chatId: "999",
      userId: "7",
      messageId: "23",
      rawText: `!resume ${SK}`,
      atList: [BOT],
    })
    const h = await p
    expect(h.sessionKey).toBe(SK)
    expect(h.by).toBe("admin")
  })

  it("非生效群 @bot 不触发", async () => {
    const spy = vi.fn()
    bus.on("message.qualified", spy)
    bus.emit("message.received", {
      channel: "qq" as const,
      chatId: "777",
      userId: "2",
      messageId: "30",
      rawText: "订单在哪",
      atList: [BOT],
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(spy).not.toHaveBeenCalled()
  })

  it("非生效群不影响管理群命令(adminGroup 豁免)", async () => {
    repo.setSessionId(SK, "sid-old")
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit("message.received", {
      channel: "qq" as const,
      chatId: "999",
      userId: "7",
      messageId: "31",
      rawText: `!reset ${SK}`,
      atList: [BOT],
    })
    const a = await p
    expect(a.chatId).toBe("999")
    expect(repo.getResumeId(SK)).toBeUndefined()
  })

  it("帮助关键词回用法", async () => {
    const p = new Promise<any>((res) => bus.once("action.send", res))
    bus.emit(
      "message.received",
      qqMsg({ messageId: "60", rawText: "帮助", atList: [BOT] })
    )
    const a = await p
    expect(a.text).toContain("@我")
    expect(a.text).toContain("example.com")
  })

  it("botMentioned=true 时不依赖 atList", async () => {
    const p = collectQualified()
    bus.emit(
      "message.received",
      qqMsg({
        messageId: "70",
        rawText: "你好",
        atList: [],
        botMentioned: true,
      })
    )
    const q = await p
    expect(q.text).toBe("你好")
  })
})
