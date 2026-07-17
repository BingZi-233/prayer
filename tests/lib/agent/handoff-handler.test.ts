import { describe, it, expect, beforeEach } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { bus } from "@/lib/bus"
import { registerHandoffHandler } from "@/lib/agent/handoff-handler"

let repo: Repo
const SK = "qq:1:2"

beforeEach(() => {
  bus.removeAllListeners()
  repo = new Repo(openDb(":memory:"))
  registerHandoffHandler({
    repo,
    adminGroupId: 999,
    handoffTimeoutMin: 30,
    scanMs: 60_000,
  })
})

describe("handoff handler", () => {
  it("handoff.requested → human_mode + 通知,不建工单", async () => {
    const sends: any[] = []
    bus.on("action.send", (a) => sends.push(a))
    bus.emit("handoff.requested", {
      channel: "qq",
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
      channel: "qq",
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
    expect(
      sends.some((s) => s.channel === "qq" && s.chatId === "999")
    ).toBe(true)
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
})
