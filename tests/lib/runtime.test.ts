import { describe, it, expect, beforeEach } from "vitest"
import { RuntimeManager, type RuntimeBuilders } from "@/lib/runtime"
import type { AppConfig } from "@/lib/config-store"
import type { Channel } from "@/lib/channels/types"

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "",
  botQQ: 1,
  extraAtQQs: [],
  adminSurface: { channel: "qq", chatId: "2" },
  enabledChats: [],
  telegramBotToken: "",
  proactiveEnabled: false,
  proactiveScanMs: 60000,
  proactiveSilenceMs: 180000,
  proactiveMaxPerScan: 2,
  handoffTimeoutMin: 30,
  dbPath: ":memory:",
  claudeConfigDir: "/tmp/cfgdir-test",
  reflectScanMs: 300000,
  reflectLookbackMs: 7200000,
  reflectSettleMs: 600000,
  reflectWindowMax: 60,
  reflectCompactMs: 86_400_000,
  reflectCompactMinEntries: 10,
  reflectPromoteMs: 86_400_000,
  reflectPromoteMinEntries: 1,
  reflectPromoteMaxPerRun: 5,
  reflectNotifyAdmin: true,
  resumeTtlMs: 300000,
  supportUrl: "https://www.packyapi.com",
  ackEnabled: true,
  maxReplyChars: 900,
  topicScanMs: 300000,
  topicSettleMs: 60000,
  topicWindowMax: 50,
  topicPromptMax: 40,
  usageBudgetUsd: 0,
  groupPolicies: {},
}

function fakeChannel(
  overrides: Partial<Channel> & {
    started?: boolean
    stopped?: boolean
  } = {}
): Channel & { started: boolean; stopped: boolean } {
  const ch = {
    id: "qq" as const,
    capabilities: {
      canNotifyOwnAdminSurface: true,
      supportsAdminCommands: true,
      supportsMemberList: true,
      supportsGroupList: true,
      supportsMediaDownload: true,
      supportsBypassPipeline: true,
    },
    started: false,
    stopped: false,
    async start() {
      this.started = true
    },
    async stop() {
      this.stopped = true
    },
    isConnected() {
      return false
    },
    status() {
      return { id: "qq" as const, connected: this.isConnected() }
    },
    async send() {
      /* no-op for runtime unit tests */
    },
    ...overrides,
  }
  return ch
}

function fakeBuilders(
  overrides: Partial<RuntimeBuilders> = {}
): RuntimeBuilders {
  return {
    openDb: () => ({}) as never,
    makeRepo: () =>
      ({
        countSessions: () => 3,
        listSessions: () => [
          { humanMode: true },
          { humanMode: true },
          { humanMode: false },
        ],
      }) as never,
    makeAgent: () => ({}) as never,
    assemble: () => () => {},
    makeQqChannel: () => fakeChannel(),
    ...overrides,
  }
}

describe("RuntimeManager", () => {
  let m: RuntimeManager
  beforeEach(() => {
    m = new RuntimeManager()
  })

  it("初始 stopped", () => {
    expect(m.getStatus().state).toBe("stopped")
  })

  it("start 后 running,getStatus 汇报会话数与队列", async () => {
    await m.start(cfg, fakeBuilders())
    const s = m.getStatus()
    expect(s.state).toBe("running")
    expect(s.sessionCount).toBe(3)
    expect(s.handoffQueue).toBe(2)
    expect(typeof s.bootedAt).toBe("number")
    expect(s.channels).toBeDefined()
    expect(s.channels!.some((c) => c.id === "qq")).toBe(true)
  })

  it("start 时设置 CLAUDE_CONFIG_DIR", async () => {
    await m.start(cfg, fakeBuilders())
    expect(process.env.CLAUDE_CONFIG_DIR).toBe("/tmp/cfgdir-test")
  })

  it("makeQqChannel.start 抛错 → allSettled 不致 runtime error,channel 记 lastError", async () => {
    const ch = fakeChannel({
      async start() {
        throw new Error("boom")
      },
      setLastError(err: string) {
        ;(this as { _err?: string })._err = err
      },
      status() {
        return {
          id: "qq" as const,
          connected: false,
          lastError: (this as { _err?: string })._err,
        }
      },
    } as never)
    await m.start(cfg, fakeBuilders({ makeQqChannel: () => ch }))
    const s = m.getStatus()
    // startAll 用 allSettled:单通道失败 runtime 仍 running
    expect(s.state).toBe("running")
    expect(s.channels?.find((c) => c.id === "qq")?.lastError).toContain("boom")
  })

  it("assemble 抛错 → error 态 + lastError", async () => {
    const b = fakeBuilders({
      assemble: () => {
        throw new Error("assemble-boom")
      },
    })
    await m.start(cfg, b)
    const s = m.getStatus()
    expect(s.state).toBe("error")
    expect(s.lastError).toContain("assemble-boom")
  })

  it("reconfigure 先 stop 旧再 start 新", async () => {
    let stops = 0
    const ch = fakeChannel({
      async stop() {
        stops++
      },
    })
    const b = fakeBuilders({ makeQqChannel: () => ch })
    await m.start(cfg, b)
    await m.reconfigure({ ...cfg, botQQ: 9 }, b)
    expect(stops).toBeGreaterThanOrEqual(1)
    expect(m.getStatus().state).toBe("running")
  })

  it("stop 调用 teardown 但不关闭 DB(连接由 sharedDb 进程级持有)", async () => {
    let teardowns = 0
    let closes = 0
    const b = fakeBuilders({
      openDb: () =>
        ({
          close: () => {
            closes++
          },
        }) as never,
      assemble: () => () => {
        teardowns++
      },
    })
    await m.start(cfg, b)
    await m.stop()
    expect(teardowns).toBe(1)
    expect(closes).toBe(0) // reconfigure/stop 不关共享连接:避免切断 in-flight scanOnce
    expect(m.getStatus().state).toBe("stopped")
  })

  it("start 抛错时回收半装配资源(teardown 被调用)", async () => {
    let teardowns = 0
    const b = fakeBuilders({
      assemble: () => () => {
        teardowns++
      },
      makeQqChannel: () => {
        throw new Error("boom")
      },
    })
    await m.start(cfg, b)
    expect(m.getStatus().state).toBe("error")
    expect(teardowns).toBe(1) // teardown 在 catch 里被调用,不泄漏
  })

  it("getGroups 委托 qq.listChats", async () => {
    const ch = fakeChannel({
      async listChats() {
        return [
          { id: "111", name: "群甲" },
          { id: "222", name: "群乙" },
        ]
      },
    })
    await m.start(cfg, fakeBuilders({ makeQqChannel: () => ch }))
    const list = await m.getGroups()
    expect(list).toEqual([
      { group_id: 111, group_name: "群甲" },
      { group_id: 222, group_name: "群乙" },
    ])
  })

  it("未 start → getGroups 返回 undefined", async () => {
    expect(await m.getGroups()).toBeUndefined()
  })

  it("qq 无 listChats → getGroups 返回 undefined", async () => {
    const ch = fakeChannel()
    // 默认 fakeChannel 无 listChats
    delete (ch as { listChats?: unknown }).listChats
    await m.start(cfg, fakeBuilders({ makeQqChannel: () => ch }))
    expect(await m.getGroups()).toBeUndefined()
  })

  it("getGroupMembers 委托 qq.listMembers", async () => {
    const ch = fakeChannel({
      async listMembers(chatId: string) {
        return [{ user_id: 5, card: "小明", group_id: Number(chatId) }]
      },
    })
    await m.start(cfg, fakeBuilders({ makeQqChannel: () => ch }))
    const list = await m.getGroupMembers(111)
    expect(list).toEqual([{ user_id: 5, card: "小明", group_id: 111 }])
  })

  it("qq 无 listMembers → getGroupMembers 返回 undefined", async () => {
    const ch = fakeChannel()
    delete (ch as { listMembers?: unknown }).listMembers
    await m.start(cfg, fakeBuilders({ makeQqChannel: () => ch }))
    expect(await m.getGroupMembers(111)).toBeUndefined()
  })

  it("onebotWsUrl 为空 → 不注册 qq 通道", async () => {
    await m.start({ ...cfg, onebotWsUrl: "" }, fakeBuilders())
    const s = m.getStatus()
    expect(s.state).toBe("running")
    expect(s.channels ?? []).toEqual([])
    expect(m.getChannel("qq")).toBeUndefined()
  })

  it("telegramBotToken 非空 → 注册 tg 通道", async () => {
    const tg = fakeChannel({
      id: "tg" as const,
      capabilities: {
        canNotifyOwnAdminSurface: false,
        supportsAdminCommands: false,
        supportsMemberList: true,
        supportsGroupList: false,
        supportsMediaDownload: false,
        supportsBypassPipeline: false,
      },
      status() {
        return { id: "tg" as const, connected: false, detail: "offset=0" }
      },
    })
    const repo = {
      countSessions: () => 0,
      listSessions: () => [],
      getConfigRow: () => undefined,
      setConfigRow: () => {},
    }
    await m.start(
      { ...cfg, telegramBotToken: "tg-token-xyz" },
      fakeBuilders({
        makeRepo: () => repo as never,
        makeTgChannel: () => tg,
      })
    )
    const s = m.getStatus()
    expect(s.state).toBe("running")
    expect(s.channels?.some((c) => c.id === "tg")).toBe(true)
    expect(m.getChannel("tg")).toBe(tg)
    // QQ 仍在
    expect(m.getChannel("qq")).toBeDefined()
  })

  it("telegramBotToken 为空 → 不注册 tg", async () => {
    let made = 0
    await m.start(
      { ...cfg, telegramBotToken: "  " },
      fakeBuilders({
        makeTgChannel: () => {
          made++
          return fakeChannel({ id: "tg" as const })
        },
      })
    )
    expect(made).toBe(0)
    expect(m.getChannel("tg")).toBeUndefined()
  })

  it("assemble 收到 resumeTtlMs 与解析后的 enabledChats/adminSurface", async () => {
    let got:
      | {
          resumeTtlMs?: number
          enabledChats?: { channel: string; chatId: string }[]
          adminSurface?: { channel: string; chatId: string } | null
        }
      | undefined
    await m.start(
      {
        ...cfg,
        resumeTtlMs: 120000,
        enabledChats: [
          { channel: "qq", chatId: "100" },
          { channel: "tg", chatId: "-1001" },
          { channel: "tg", chatId: "-1002" },
        ],
        adminSurface: { channel: "qq", chatId: "2" },
      },
      fakeBuilders({
        assemble: (args) => {
          got = args
          return () => {}
        },
      })
    )
    expect(got?.resumeTtlMs).toBe(120000)
    expect(got?.enabledChats).toEqual([
      { channel: "qq", chatId: "100" },
      { channel: "tg", chatId: "-1001" },
      { channel: "tg", chatId: "-1002" },
    ])
    expect(got?.adminSurface).toEqual({ channel: "qq", chatId: "2" })
  })
})
