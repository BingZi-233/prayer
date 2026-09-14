import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  RuntimeManager,
  runtimeFailureMessage,
  serializeRuntimeMutation,
  type RuntimeBuilders,
} from "@/lib/runtime"
import type { AppConfig } from "@/lib/core/config-store"
import type { Channel } from "@/lib/core/chat/types"
import { bus } from "@/lib/core/bus"

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
  kbPrefetchEnabled: true,
  kbPrefetchTopK: 5,
  kbPrefetchMaxDistance: 1.0,
  supportUrl: "https://www.packyapi.ai",
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
        countHumanSessions: () => 2,
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
  afterEach(async () => {
    // Most lifecycle cases intentionally leave the manager running to inspect
    // its state; close it here so its registry listener cannot leak into the
    // next test now that teardown preserves unrelated bus subscribers.
    await m.stop()
  })

  it("管理 mutation 队列按提交顺序执行，并在失败后释放", async () => {
    const events: string[] = []
    let release!: () => void
    let started!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = serializeRuntimeMutation(async () => {
      events.push("first:start")
      started()
      await gate
      events.push("first:end")
      throw new Error("expected")
    }).catch(() => undefined)
    const second = serializeRuntimeMutation(async () => {
      events.push("second")
    })
    await firstStarted
    expect(events).toEqual(["first:start"])
    release()
    await Promise.all([first, second])
    expect(events).toEqual(["first:start", "first:end", "second"])
  })

  it("初始 stopped", () => {
    expect(m.getStatus().state).toBe("stopped")
    expect(m.getStatus().ready).toBe(false)
  })

  it("start 后必要通道未连接则 degraded,getStatus 汇报会话数与队列", async () => {
    await m.start(cfg, fakeBuilders())
    const s = m.getStatus()
    expect(s.state).toBe("degraded")
    expect(s.ready).toBe(false) // fake channel 未声明已连接
    expect(s.sessionCount).toBe(3)
    expect(s.handoffQueue).toBe(2)
    expect(typeof s.bootedAt).toBe("number")
    expect(s.channels).toBeDefined()
    expect(s.channels!.some((c) => c.id === "qq")).toBe(true)
  })

  it("start 时设置 CLAUDE_CONFIG_DIR", async () => {
    await m.start(cfg, fakeBuilders())
    expect(process.env.CLAUDE_CONFIG_DIR).toBe("/tmp/cfgdir-test")
    // SQLite URI 不能经过 path.resolve，否则 :memory: 会被误当成磁盘文件。
    expect(process.env.DB_PATH).toBe(":memory:")
  })

  it("makeQqChannel.start 抛错 → runtime 进入 degraded,channel 记 lastError", async () => {
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
    expect(s.state).toBe("degraded")
    expect(s.ready).toBe(false)
    expect(s.channels?.find((c) => c.id === "qq")?.lastError).toContain("boom")
  })

  it("状态诊断会脱敏凭据", async () => {
    const secret = "sk-ant-api03-abcdefghijklmnop"
    const ch = fakeChannel({
      async start() {
        throw new Error(`provider failed token=${secret}`)
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
    const status = m.getStatus()
    expect(status.lastError).toContain("[REDACTED]")
    expect(status.lastError).not.toContain(secret)
    expect(status.channels?.[0]?.lastError).not.toContain(secret)
  })

  it("必要通道连接后 readiness 为 true", async () => {
    const ch = fakeChannel({
      isConnected() {
        return true
      },
    })
    await m.start(cfg, fakeBuilders({ makeQqChannel: () => ch }))
    expect(m.getReadiness()).toEqual(
      expect.objectContaining({
        ready: true,
        state: "running",
        requiredChannels: ["qq"],
        unavailableChannels: [],
      })
    )
  })

  it("启用会话引用未注册通道 → readiness 不通过并列出通道", async () => {
    await m.start(
      {
        ...cfg,
        onebotWsUrl: "",
        enabledChats: [{ channel: "tg", chatId: "-100" }],
      },
      fakeBuilders()
    )
    const readiness = m.getReadiness()
    expect(readiness.ready).toBe(false)
    expect(readiness.requiredChannels).toEqual(["tg", "qq"])
    expect(readiness.unavailableChannels.map((c) => c.id)).toEqual(["tg", "qq"])
  })

  it("required 通道缺少凭据或 adapter → 明确失败，不能误报配置成功", async () => {
    await m.start(
      {
        ...cfg,
        onebotWsUrl: "",
        adminSurface: null,
        telegramBotToken: "",
        enabledChats: [
          { channel: "tg", chatId: "-100" },
          { channel: "discord", chatId: "42" },
        ],
      },
      fakeBuilders()
    )

    const status = m.getStatus()
    expect(status.state).toBe("degraded")
    expect(status.lastError).toContain(
      "tg: channel not registered (missing credentials or adapter)"
    )
    expect(status.lastError).toContain(
      "discord: channel not registered (missing credentials or adapter)"
    )
    expect(runtimeFailureMessage(status)).toBe(status.lastError)
    expect(m.getReadiness().unavailableChannels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tg",
          lastError: expect.stringContaining("missing credentials or adapter"),
        }),
        expect.objectContaining({
          id: "discord",
          lastError: expect.stringContaining("missing credentials or adapter"),
        }),
      ])
    )
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
    expect(m.getReadiness()).toMatchObject({
      state: "error",
      requiredChannels: ["qq"],
      unavailableChannels: [{ id: "qq", connected: false }],
    })
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
    expect(m.getStatus().state).toBe("degraded")
  })

  it("并发 reconfigure 串行执行，不交错生命周期", async () => {
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    let signalFirst: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      signalFirst = resolve
    })
    let first = true
    const b = fakeBuilders({
      makeQqChannel: () =>
        fakeChannel({
          async start() {
            events.push("start")
            if (first) {
              first = false
              signalFirst!()
              await new Promise<void>((resolve) => {
                releaseFirst = resolve
              })
            }
          },
          async stop() {
            events.push("stop")
          },
          isConnected() {
            return true
          },
        }),
    })
    const pending = m.start(cfg, b)
    await firstStarted
    const reconfigured = m.reconfigure({ ...cfg, botQQ: 9 }, b)
    expect(events).toEqual(["start"])
    releaseFirst!()
    await Promise.all([pending, reconfigured])
    expect(events).toEqual(["start", "stop", "start"])
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

  it("stop 不会清空进程级总线上的外部监听器", async () => {
    const external = () => {}
    const leaked = () => {}
    bus.on("message.received", external)
    const b = fakeBuilders({
      assemble: () => {
        // 模拟第三方装配器留下的监听器；runtime 只能诊断，不能误删外部订阅。
        bus.on("action.send", leaked)
        return () => {}
      },
    })
    try {
      await m.start(cfg, b)
      await m.stop()
      expect(bus.listeners("message.received")).toContain(external)
      expect(bus.listeners("action.send")).toContain(leaked)
    } finally {
      bus.off("message.received", external)
      bus.off("action.send", leaked)
    }
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
    expect(s.state).toBe("degraded")
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
      countHumanSessions: () => 0,
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
    expect(s.state).toBe("degraded")
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
