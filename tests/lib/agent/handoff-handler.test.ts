import { describe, it, expect, beforeEach } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { bus } from "@/lib/bus"
import { registerHandoffHandler } from "@/lib/agent/handoff-handler"

let repo: Repo
const SK = "qq:1:2"
const ADMIN = { channel: "qq" as const, chatId: "999" }

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:"))
  registerHandoffHandler({
    repo,
    adminSurface: ADMIN,
    handoffTimeoutMin: 30,
    scanMs: 60_000,
  })
})

describe("handoff handler", () => {
  it("handoff.requested → human_mode + 通知,不建工单", async () => {
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.requested", {
      channel: "qq" as const,
      sessionKey: SK,
      chatId: "1",
      userId: "2",
      lastQuestion: "退款",
      reason: "user",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(repo.isHumanMode(SK)).toBe(true)
    expect(repo.openTickets().length).toBe(0)
    expect(
      sends.some(
        (s) => s.channel === "qq" && s.chatId === "1" && s.text.includes("转接")
      )
    ).toBe(true)
    expect(
      sends.some(
        (s) =>
          s.channel === "qq" && s.chatId === "999" && s.text.includes("转人工")
      )
    ).toBe(true)
    expect(sends.some((s) => String(s.text).includes("工单"))).toBe(false)
  })

  it("handoff.resumed → 清 human_mode 并回用户会话", async () => {
    bus.emit("handoff.requested", {
      channel: "qq" as const,
      sessionKey: SK,
      chatId: "1",
      userId: "2",
      lastQuestion: "退款",
    })
    await new Promise((r) => setTimeout(r, 10))
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.resumed", { sessionKey: SK, by: "admin" })
    await new Promise((r) => setTimeout(r, 10))
    expect(repo.isHumanMode(SK)).toBe(false)
    expect(
      sends.some(
        (s) =>
          s.channel === "qq" &&
          s.chatId === "1" &&
          s.text.includes("恢复自动客服")
      )
    ).toBe(true)
    expect(sends.some((s) => s.channel === "qq" && s.chatId === "999")).toBe(
      true
    )
  })

  it("历史两段 sessionKey 恢复时也能解析 chat", async () => {
    const legacy = "1:2"
    repo.setHumanMode(legacy, true)
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.resumed", { sessionKey: legacy, by: "admin" })
    await new Promise((r) => setTimeout(r, 10))
    expect(repo.isHumanMode(legacy)).toBe(false)
    expect(
      sends.some(
        (s) => s.channel === "qq" && s.chatId === "1" && s.text.includes("恢复")
      )
    ).toBe(true)
  })

  it("TG 用户 handoff → 用户回 TG，通知发 adminSurface(QQ)", async () => {
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.requested", {
      channel: "tg" as const,
      sessionKey: "tg:-1001:42",
      chatId: "-1001",
      userId: "42",
      lastQuestion: "怎么退款",
      reason: "user",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(repo.isHumanMode("tg:-1001:42")).toBe(true)
    expect(
      sends.some(
        (s) =>
          s.channel === "tg" && s.chatId === "-1001" && s.text.includes("转接")
      )
    ).toBe(true)
    expect(
      sends.some(
        (s) =>
          s.channel === "qq" &&
          s.chatId === "999" &&
          s.text.includes("转人工") &&
          s.text.includes("tg:-1001")
      )
    ).toBe(true)
    // 不发明 TG 管理桌
    expect(
      sends.filter((s) => s.channel === "tg" && s.text.includes("转人工"))
        .length
    ).toBe(0)
  })

  it("adminSurface 为 TG 时 QQ 用户 handoff → 通知发 TG", async () => {
    bus.removeAllListeners()
    repo = new Repo(openDb(":memory:"))
    registerHandoffHandler({
      repo,
      adminSurface: { channel: "tg" as const, chatId: "-100999" },
      handoffTimeoutMin: 30,
      scanMs: 60_000,
    })
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.requested", {
      channel: "qq" as const,
      sessionKey: SK,
      chatId: "1",
      userId: "2",
      lastQuestion: "退款",
      reason: "user",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(repo.isHumanMode(SK)).toBe(true)
    expect(
      sends.some(
        (s) => s.channel === "qq" && s.chatId === "1" && s.text.includes("转接")
      )
    ).toBe(true)
    expect(
      sends.some(
        (s) =>
          s.channel === "tg" &&
          s.chatId === "-100999" &&
          s.text.includes("转人工") &&
          s.text.includes(SK)
      )
    ).toBe(true)
    // 不应再抄送到旧 QQ 管理面
    expect(
      sends.filter((s) => s.channel === "qq" && s.chatId === "999").length
    ).toBe(0)
  })

  it("adminSurface 为 TG 时 TG 用户 handoff → 用户回 TG，通知也发 TG 管理面", async () => {
    bus.removeAllListeners()
    repo = new Repo(openDb(":memory:"))
    registerHandoffHandler({
      repo,
      adminSurface: { channel: "tg" as const, chatId: "-100999" },
      handoffTimeoutMin: 30,
      scanMs: 60_000,
    })
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.requested", {
      channel: "tg" as const,
      sessionKey: "tg:-1001:42",
      chatId: "-1001",
      userId: "42",
      lastQuestion: "怎么退款",
      reason: "user",
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(
      sends.some(
        (s) =>
          s.channel === "tg" && s.chatId === "-1001" && s.text.includes("转接")
      )
    ).toBe(true)
    expect(
      sends.some(
        (s) =>
          s.channel === "tg" &&
          s.chatId === "-100999" &&
          s.text.includes("转人工")
      )
    ).toBe(true)
  })
})
