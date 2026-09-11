import { describe, it, expect } from "vitest"
import {
  createChannels,
  DEFAULT_CHANNEL_FACTORIES,
  type ChannelFactoryContext,
} from "@/lib/channels/factory"
import type { AppConfig } from "@/lib/core/config-store"
import type { Channel } from "@/lib/core/chat/types"

function baseCfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    onebotWsUrl: "",
    onebotAccessToken: "",
    botQQ: 0,
    extraAtQQs: [],
    adminSurface: null,
    handoffTimeoutMin: 30,
    dbPath: "./data/agent.db",
    claudeConfigDir: "./data/claude-config",
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
    enabledChats: [],
    telegramBotToken: "",
    proactiveEnabled: false,
    proactiveScanMs: 60000,
    proactiveSilenceMs: 180000,
    proactiveMaxPerScan: 2,
    supportUrl: "https://www.packyapi.ai",
    ackEnabled: true,
    maxReplyChars: 900,
    topicScanMs: 300000,
    topicSettleMs: 60000,
    topicWindowMax: 50,
    topicPromptMax: 40,
    usageBudgetUsd: 0,
    groupPolicies: {},
    ...over,
  }
}

function stubChannel(id: Channel["id"]): Channel {
  return {
    id,
    capabilities: {
      canNotifyOwnAdminSurface: id === "qq",
      supportsAdminCommands: id === "qq",
      supportsMemberList: true,
      supportsGroupList: id === "qq",
      supportsMediaDownload: id === "qq",
      supportsBypassPipeline: id === "qq",
    },
    async start() {},
    async stop() {},
    isConnected() {
      return false
    },
    status() {
      return { id, connected: false }
    },
    async send() {},
  }
}

function ctx(
  over: Partial<ChannelFactoryContext> & { cfg?: AppConfig } = {}
): ChannelFactoryContext {
  return {
    cfg: over.cfg ?? baseCfg(),
    repo: {
      getConfigRow: () => undefined,
      setConfigRow: () => {},
    } as never,
    onStatus: over.onStatus,
    overrides: over.overrides,
  }
}

describe("createChannels", () => {
  it("无凭证 → 空列表", () => {
    expect(createChannels(ctx())).toEqual([])
  })

  it("仅 onebotWsUrl → 注册 qq", () => {
    const qq = stubChannel("qq")
    const list = createChannels(
      ctx({
        cfg: baseCfg({ onebotWsUrl: "ws://x" }),
        overrides: { qq: () => qq },
      })
    )
    expect(list).toEqual([qq])
  })

  it("仅 telegramBotToken → 注册 tg", () => {
    const tg = stubChannel("tg")
    const list = createChannels(
      ctx({
        cfg: baseCfg({ telegramBotToken: "tok" }),
        overrides: { tg: () => tg },
      })
    )
    expect(list).toEqual([tg])
  })

  it("双凭证 → qq 在前 tg 在后", () => {
    const qq = stubChannel("qq")
    const tg = stubChannel("tg")
    const list = createChannels(
      ctx({
        cfg: baseCfg({
          onebotWsUrl: "ws://x",
          telegramBotToken: "tok",
        }),
        overrides: {
          qq: () => qq,
          tg: () => tg,
        },
      })
    )
    expect(list.map((c) => c.id)).toEqual(["qq", "tg"])
  })

  it("override 返回 null → 跳过该通道", () => {
    const list = createChannels(
      ctx({
        cfg: baseCfg({ onebotWsUrl: "ws://x", telegramBotToken: "tok" }),
        overrides: {
          qq: () => null,
          tg: () => stubChannel("tg"),
        },
      })
    )
    expect(list.map((c) => c.id)).toEqual(["tg"])
  })

  it("构造抛错向上抛", () => {
    expect(() =>
      createChannels(
        ctx({
          cfg: baseCfg({ onebotWsUrl: "ws://x" }),
          overrides: {
            qq: () => {
              throw new Error("factory-boom")
            },
          },
        })
      )
    ).toThrow(/factory-boom/)
  })

  it("DEFAULT_CHANNEL_FACTORIES 含 qq/tg", () => {
    expect(DEFAULT_CHANNEL_FACTORIES.map((e) => e.id)).toEqual(["qq", "tg"])
  })

  it("默认 qq 工厂在无 override 时用 onebotWsUrl 判定", () => {
    // 用 vi.fn override 之外的路径：空 url 不创建；有 url 会 new QqChannel（需 ws 可构造）
    // 这里只断言空 url 跳过，避免真实 WS
    const list = createChannels(
      ctx({ cfg: baseCfg({ onebotWsUrl: "  ", telegramBotToken: "" }) })
    )
    expect(list).toEqual([])
  })
})
