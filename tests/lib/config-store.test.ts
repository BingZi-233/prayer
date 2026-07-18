import { describe, it, expect } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import {
  getConfig,
  setConfig,
  parseQQList,
  parseChatIdList,
  migrateConfigShape,
  enabledChatsFromLegacy,
  normalizeChatRefs,
  normalizeAdminSurface,
} from "@/lib/config-store"

function mkRepo(): Repo {
  return new Repo(openDb(":memory:", 3))
}

describe("parseQQList", () => {
  it("逗号/空白分隔并去重", () => {
    expect(parseQQList("111, 222 333,111")).toEqual([111, 222, 333])
  })
  it("空/非法 → []", () => {
    expect(parseQQList(undefined)).toEqual([])
    expect(parseQQList("")).toEqual([])
    expect(parseQQList("0, -1, abc")).toEqual([])
  })
})

describe("parseChatIdList", () => {
  it("逗号/空白分隔并去重,保留字符串(含负 id)", () => {
    expect(parseChatIdList("-100123, 42 -100123,99")).toEqual([
      "-100123",
      "42",
      "99",
    ])
  })
  it("空 → []", () => {
    expect(parseChatIdList(undefined)).toEqual([])
    expect(parseChatIdList("")).toEqual([])
    expect(parseChatIdList("  ,  ")).toEqual([])
  })
  it("绝不 Number():大整数/负号原样", () => {
    expect(parseChatIdList("-100123456789012345")).toEqual([
      "-100123456789012345",
    ])
  })
})

describe("enabledChatsFromLegacy / normalize", () => {
  it("legacy 双字段 → chat-ref", () => {
    expect(enabledChatsFromLegacy([111, 222], ["-100", "42"])).toEqual([
      { channel: "qq", chatId: "111" },
      { channel: "qq", chatId: "222" },
      { channel: "tg", chatId: "-100" },
      { channel: "tg", chatId: "42" },
    ])
  })
  it("normalizeChatRefs 去重 + 校验", () => {
    expect(
      normalizeChatRefs([
        { channel: "qq", chatId: "1" },
        { channel: "qq", chatId: "1" },
        { channel: "nope", chatId: "x" },
        { channel: "tg", chatId: "  " },
        { channel: "tg", chatId: "-9" },
      ])
    ).toEqual([
      { channel: "qq", chatId: "1" },
      { channel: "tg", chatId: "-9" },
    ])
  })
  it("normalizeAdminSurface", () => {
    expect(normalizeAdminSurface({ channel: "qq", chatId: "9" })).toEqual({
      channel: "qq",
      chatId: "9",
    })
    expect(normalizeAdminSurface(null)).toBeNull()
    expect(normalizeAdminSurface({})).toBeNull()
  })
})

describe("config-store", () => {
  it("无行时用 env 种子并落库", () => {
    const repo = mkRepo()
    const cfg = getConfig(repo, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "111",
      ADMIN_GROUP_ID: "222",
    })
    expect(cfg.onebotWsUrl).toBe("ws://x:1")
    expect(cfg.botQQ).toBe(111)
    expect(cfg.adminSurface).toEqual({ channel: "qq", chatId: "222" })
    // 已落库:再读(空 env)仍拿到
    const again = getConfig(repo, {})
    expect(again.botQQ).toBe(111)
    expect(again.adminSurface).toEqual({ channel: "qq", chatId: "222" })
  })

  it("setConfig 局部更新并持久化", () => {
    const repo = mkRepo()
    getConfig(repo, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
      ADMIN_GROUP_ID: "2",
    })
    setConfig(repo, { botQQ: 999 })
    const cfg = getConfig(repo, {})
    expect(cfg.botQQ).toBe(999)
    expect(cfg.onebotWsUrl).toBe("ws://x:1") // 未改字段保留
  })

  it("默认值:handoffTimeoutMin=30, dbPath, claudeConfigDir", () => {
    const repo = mkRepo()
    const cfg = getConfig(repo, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
      ADMIN_GROUP_ID: "2",
    })
    expect(cfg.handoffTimeoutMin).toBe(30)
    expect(cfg.dbPath).toBe("./data/agent.db")
    expect(cfg.claudeConfigDir).toBe("./data/claude-config")
  })

  it("旧库缺字段:读取时用默认值补齐", () => {
    const repo = mkRepo()
    // 模拟老版本只存了部分字段的行
    repo.setConfigRow(
      "app",
      JSON.stringify({ botQQ: 5, onebotWsUrl: "ws://old:1" })
    )
    const cfg = getConfig(repo, {})
    expect(cfg.botQQ).toBe(5) // 存储值优先
    expect(cfg.onebotWsUrl).toBe("ws://old:1")
    expect(cfg.claudeConfigDir).toBe("./data/claude-config") // 缺失字段补默认
    expect(cfg.handoffTimeoutMin).toBe(30)
  })

  it("reflect 参数有默认值,env 可覆盖", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const cfg = getConfig(repo, { REFLECT_SETTLE_MS: "1000" } as any)
    expect(cfg.reflectSettleMs).toBe(1000)
    expect(cfg.reflectScanMs).toBe(300000) // 默认
    expect(cfg.reflectLookbackMs).toBe(7200000)
    expect(cfg.reflectWindowMax).toBe(60)
  })

  it("反思压缩默认值 + env 覆盖", () => {
    const repo = mkRepo()
    const cfg = getConfig(repo, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
      ADMIN_GROUP_ID: "2",
    })
    expect(cfg.reflectCompactMs).toBe(86_400_000)
    expect(cfg.reflectCompactMinEntries).toBe(10)
    const repo2 = mkRepo()
    const cfg2 = getConfig(repo2, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
      ADMIN_GROUP_ID: "2",
      REFLECT_COMPACT_MS: "3600000",
      REFLECT_COMPACT_MIN_ENTRIES: "5",
    })
    expect(cfg2.reflectCompactMs).toBe(3_600_000)
    expect(cfg2.reflectCompactMinEntries).toBe(5)
  })

  it("自动升格默认值 + env 覆盖", () => {
    const repo = mkRepo()
    const cfg = getConfig(repo, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
      ADMIN_GROUP_ID: "2",
    })
    expect(cfg.reflectPromoteMs).toBe(86_400_000)
    expect(cfg.reflectPromoteMinEntries).toBe(1)
    expect(cfg.reflectPromoteMaxPerRun).toBe(5)
    const repo2 = mkRepo()
    const cfg2 = getConfig(repo2, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
      ADMIN_GROUP_ID: "2",
      REFLECT_PROMOTE_MS: "3600000",
      REFLECT_PROMOTE_MIN_ENTRIES: "3",
      REFLECT_PROMOTE_MAX_PER_RUN: "2",
    })
    expect(cfg2.reflectPromoteMs).toBe(3_600_000)
    expect(cfg2.reflectPromoteMinEntries).toBe(3)
    expect(cfg2.reflectPromoteMaxPerRun).toBe(2)
  })

  it("enabledChats 默认空数组;setConfig 可写", () => {
    const repo = mkRepo()
    const cfg = getConfig(repo, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
    })
    expect(cfg.enabledChats).toEqual([])
    setConfig(repo, {
      enabledChats: [
        { channel: "qq", chatId: "100" },
        { channel: "tg", chatId: "-99" },
      ],
    })
    expect(getConfig(repo, {}).enabledChats).toEqual([
      { channel: "qq", chatId: "100" },
      { channel: "tg", chatId: "-99" },
    ])
  })

  it("旧库 dual fields 一次性 migrate 写回 SOT", () => {
    const repo = mkRepo()
    repo.setConfigRow(
      "app",
      JSON.stringify({
        botQQ: 5,
        adminGroupId: 999,
        enabledGroups: [100, 200],
        telegramEnabledChats: ["-100123"],
        telegramBotToken: "tok",
      })
    )
    const cfg = getConfig(repo, {})
    expect(cfg.adminSurface).toEqual({ channel: "qq", chatId: "999" })
    expect(cfg.enabledChats).toEqual([
      { channel: "qq", chatId: "100" },
      { channel: "qq", chatId: "200" },
      { channel: "tg", chatId: "-100123" },
    ])
    expect(cfg.telegramBotToken).toBe("tok")
    // 写回后磁盘无 legacy 键
    const stored = JSON.parse(repo.getConfigRow("app")!) as Record<
      string,
      unknown
    >
    expect(stored).not.toHaveProperty("adminGroupId")
    expect(stored).not.toHaveProperty("enabledGroups")
    expect(stored).not.toHaveProperty("telegramEnabledChats")
    expect(stored.enabledChats).toEqual(cfg.enabledChats)
    expect(stored.adminSurface).toEqual(cfg.adminSurface)
  })

  it("telegram token 默认空;env 可种子;setConfig 可写", () => {
    const repo = mkRepo()
    const cfg = getConfig(repo, {})
    expect(cfg.telegramBotToken).toBe("")

    const repo2 = mkRepo()
    const cfg2 = getConfig(repo2, {
      TELEGRAM_BOT_TOKEN: "tok-abc",
      TELEGRAM_ENABLED_CHATS: "-100123, 42 -100123",
    })
    expect(cfg2.telegramBotToken).toBe("tok-abc")
    expect(cfg2.enabledChats).toEqual([
      { channel: "tg", chatId: "-100123" },
      { channel: "tg", chatId: "42" },
    ])

    setConfig(repo, {
      telegramBotToken: "new-tok",
      enabledChats: [{ channel: "tg", chatId: "-99" }],
    })
    const again = getConfig(repo, {})
    expect(again.telegramBotToken).toBe("new-tok")
    expect(again.enabledChats).toEqual([{ channel: "tg", chatId: "-99" }])
  })

  it("旧库缺 telegram/enabledChats 补默认", () => {
    const repo = mkRepo()
    repo.setConfigRow("app", JSON.stringify({ botQQ: 5 }))
    const cfg = getConfig(repo, {})
    expect(cfg.telegramBotToken).toBe("")
    expect(cfg.enabledChats).toEqual([])
    expect(cfg.adminSurface).toBeNull()
  })

  it("extraAtQQs 默认 [];env EXTRA_AT_QQS;setConfig 可改", () => {
    const repo = mkRepo()
    expect(getConfig(repo, {}).extraAtQQs).toEqual([])
    const repo2 = mkRepo()
    expect(getConfig(repo2, { EXTRA_AT_QQS: "111, 222" }).extraAtQQs).toEqual([
      111, 222,
    ])
    setConfig(repo, { extraAtQQs: [333] })
    expect(getConfig(repo, {}).extraAtQQs).toEqual([333])
  })

  it("旧库缺 extraAtQQs 补空数组", () => {
    const repo = mkRepo()
    repo.setConfigRow("app", JSON.stringify({ botQQ: 5 }))
    expect(getConfig(repo, {}).extraAtQQs).toEqual([])
  })

  it("reflectNotifyAdmin 默认 true;env false 关闭;setConfig 可改", () => {
    const repo = mkRepo()
    expect(getConfig(repo, {}).reflectNotifyAdmin).toBe(true)
    const repo2 = mkRepo()
    expect(
      getConfig(repo2, { REFLECT_NOTIFY_ADMIN: "false" }).reflectNotifyAdmin
    ).toBe(false)
    setConfig(repo, { reflectNotifyAdmin: false })
    expect(getConfig(repo, {}).reflectNotifyAdmin).toBe(false)
  })

  it("resumeTtlMs 默认 300000;env RESUME_TTL_MS 覆盖", () => {
    const repo = mkRepo()
    expect(getConfig(repo, {}).resumeTtlMs).toBe(300000)
    const repo2 = mkRepo()
    expect(getConfig(repo2, { RESUME_TTL_MS: "120000" }).resumeTtlMs).toBe(
      120000
    )
    setConfig(repo, { resumeTtlMs: 60000 })
    expect(getConfig(repo, {}).resumeTtlMs).toBe(60000)
  })

  it("migrateConfigShape 已是 SOT 不标 migrated（无 legacy 键）", () => {
    const seed = getConfig(mkRepo(), {})
    const { cfg, migrated } = migrateConfigShape(
      {
        botQQ: 1,
        enabledChats: [{ channel: "qq", chatId: "1" }],
        adminSurface: { channel: "qq", chatId: "2" },
      },
      seed
    )
    expect(migrated).toBe(false)
    expect(cfg.enabledChats).toEqual([{ channel: "qq", chatId: "1" }])
    expect(cfg.adminSurface).toEqual({ channel: "qq", chatId: "2" })
  })
})

describe("config-store proactive 字段", () => {
  it("无 env → proactive 默认值(默认关)", () => {
    const repo = new Repo(openDb(":memory:"))
    const cfg = getConfig(repo, {})
    expect(cfg.proactiveEnabled).toBe(false)
    expect(cfg.proactiveScanMs).toBe(60000)
    expect(cfg.proactiveSilenceMs).toBe(180000)
    expect(cfg.proactiveMaxPerScan).toBe(2)
  })

  it("env 覆盖 proactive 字段", () => {
    const repo = new Repo(openDb(":memory:"))
    const cfg = getConfig(repo, {
      PROACTIVE_ENABLED: "true",
      PROACTIVE_SCAN_MS: "30000",
      PROACTIVE_SILENCE_MS: "120000",
      PROACTIVE_MAX_PER_SCAN: "5",
    })
    expect(cfg.proactiveEnabled).toBe(true)
    expect(cfg.proactiveScanMs).toBe(30000)
    expect(cfg.proactiveSilenceMs).toBe(120000)
    expect(cfg.proactiveMaxPerScan).toBe(5)
  })
})
