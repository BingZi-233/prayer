/**
 * 端到端：ChannelRegistry.isBypassEnabled → unanswered runScan 门控。
 * agent 不 import channels/tg/bypass-state。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { bus } from "@/lib/core/bus"
import { SessionStore } from "@/lib/agent/session"
import { runScan } from "@/lib/agent/unanswered-poller"
import { ChannelRegistry } from "@/lib/channels/registry"
import type {
  Channel,
  ChannelCapabilities,
  ChannelId,
} from "@/lib/channels/types"
import type Database from "better-sqlite3"
import {
  isTgChatBypassEnabled,
  setTgBypassBlocked,
  _resetTgBypassStateForTests,
} from "@/lib/channels/tg/bypass-state"

const NOW = 10_000_000

/** Repo.db 是 private;测试需要直写 SQL 种子数据 */
const repoDb = (repo: Repo) => (repo as unknown as { db: Database.Database }).db
const caps: ChannelCapabilities = {
  canNotifyOwnAdminSurface: false,
  supportsAdminCommands: false,
  supportsMemberList: false,
  supportsGroupList: false,
  supportsMediaDownload: false,
  supportsBypassPipeline: true,
}

/** 模拟 TG channel：isBypassEnabled 读真实 bypass-state */
function makeTgChannel(): Channel {
  return {
    id: "tg",
    capabilities: caps,
    async start() {},
    async stop() {},
    isConnected: () => true,
    status: () => ({ id: "tg", connected: true }),
    async send() {},
    isBypassEnabled: (chatId: string) => {
      // 与 TelegramChannel 相同：读 module 级 bypass-state
      return isTgChatBypassEnabled(chatId)
    },
  }
}

let repo: Repo

beforeEach(() => {
  bus.removeAllListeners()
  _resetTgBypassStateForTests()
  repo = new Repo(openDb(":memory:"))
})

describe("registry → poller bypass chain", () => {
  it("TG channel 封锁后，经 registry.isBypassEnabled 注入的 poller 跳过该 chat", async () => {
    const reg = new ChannelRegistry()
    reg.register(makeTgChannel())
    setTgBypassBlocked("-1001", "admins-failed")

    repoDb(repo)
      .prepare(
        "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
      )
      .run("tg", "-1001", "200", "member", "价格?", NOW - 5000)
    repo.setGroupProactiveCursor("tg", "-1001", 1)

    const agent = { run: vi.fn(async () => ({ text: "答案", sessionId: "s" })) }
    await runScan({
      repo,
      store: new SessionStore(repo, 0),
      classify: async () => true,
      adminSurface: null,
      enabledChats: [{ channel: "tg" as const, chatId: "-1001" }],
      silenceMs: 1000,
      maxPerScan: 2,
      now: () => NOW,
      agent: agent as never,
      isBypassEnabled: (channel: ChannelId, chatId: string) =>
        reg.isBypassEnabled(channel, chatId),
    })

    expect(agent.run).not.toHaveBeenCalled()
    expect(repo.groupProactiveCursor("tg", "-1001")).toBe(1)
  })

  it("未封锁时 poller 正常调 agent", async () => {
    const reg = new ChannelRegistry()
    reg.register(makeTgChannel())

    repoDb(repo)
      .prepare(
        "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
      )
      .run("tg", "-1001", "200", "member", "价格?", NOW - 5000)
    repo.setGroupProactiveCursor("tg", "-1001", 1)

    const agent = {
      run: vi.fn(async () => ({ text: "这是答案", sessionId: "s" })),
    }
    await runScan({
      repo,
      store: new SessionStore(repo, 0),
      classify: async () => true,
      adminSurface: null,
      enabledChats: [{ channel: "tg" as const, chatId: "-1001" }],
      silenceMs: 1000,
      maxPerScan: 2,
      now: () => NOW,
      agent: agent as never,
      isBypassEnabled: (channel: ChannelId, chatId: string) =>
        reg.isBypassEnabled(channel, chatId),
    })

    expect(agent.run).toHaveBeenCalledTimes(1)
  })
})
