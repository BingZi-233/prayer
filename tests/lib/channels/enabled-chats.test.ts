import { describe, it, expect } from "vitest"
import type { AppConfig } from "@/lib/config-store"
import {
  listEnabledChats,
  isChatEnabled,
  policyKey,
  getGroupPolicy,
} from "@/lib/channels/enabled-chats"

function baseCfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    onebotWsUrl: "",
    onebotAccessToken: "",
    botQQ: 0,
    extraAtQQs: [],
    adminGroupId: 0,
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
    enabledGroups: [],
    telegramBotToken: "",
    telegramEnabledChats: [],
    proactiveEnabled: false,
    proactiveScanMs: 60000,
    proactiveSilenceMs: 180000,
    proactiveMaxPerScan: 2,
    supportUrl: "https://www.packyapi.com",
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

describe("policyKey", () => {
  it("拼 channel:chatId", () => {
    expect(policyKey("qq", "100")).toBe("qq:100")
    expect(policyKey("tg", "-100123")).toBe("tg:-100123")
  })
})

describe("listEnabledChats", () => {
  it("合并 QQ enabledGroups 与 TG telegramEnabledChats", () => {
    const cfg = baseCfg({
      enabledGroups: [111, 222],
      telegramEnabledChats: ["-100123", "42"],
    })
    expect(listEnabledChats(cfg)).toEqual([
      { channel: "qq", chatId: "111" },
      { channel: "qq", chatId: "222" },
      { channel: "tg", chatId: "-100123" },
      { channel: "tg", chatId: "42" },
    ])
  })

  it("空配置 → []", () => {
    expect(listEnabledChats(baseCfg())).toEqual([])
  })
})

describe("isChatEnabled", () => {
  it("QQ 群号命中 enabledGroups", () => {
    const cfg = baseCfg({ enabledGroups: [100, 200] })
    expect(isChatEnabled(cfg, "qq", "100")).toBe(true)
    expect(isChatEnabled(cfg, "qq", "200")).toBe(true)
    expect(isChatEnabled(cfg, "qq", "999")).toBe(false)
  })

  it("TG chatId 字符串比较（含负 id）", () => {
    const cfg = baseCfg({ telegramEnabledChats: ["-100123456", "42"] })
    expect(isChatEnabled(cfg, "tg", "-100123456")).toBe(true)
    expect(isChatEnabled(cfg, "tg", "42")).toBe(true)
    expect(isChatEnabled(cfg, "tg", "100123456")).toBe(false)
    // 数字比较会误伤负 id；必须严格字符串
    expect(isChatEnabled(cfg, "tg", "-100123456.0")).toBe(false)
  })

  it("其它通道 / 错通道不命中", () => {
    const cfg = baseCfg({
      enabledGroups: [100],
      telegramEnabledChats: ["-100"],
    })
    // QQ 白名单不让 TG 过
    expect(isChatEnabled(cfg, "tg", "100")).toBe(false)
    // TG 白名单不让 QQ 过
    expect(isChatEnabled(cfg, "qq", "-100")).toBe(false)
    // discord 一期未实现
    expect(isChatEnabled(cfg, "discord", "100")).toBe(false)
  })
})

describe("getGroupPolicy", () => {
  it("优先新键 channel:chatId", () => {
    const cfg = baseCfg({
      groupPolicies: {
        "qq:100": { proactiveEnabled: true },
        "100": { proactiveEnabled: false },
        "tg:-100123": { notifyAdminOnHandoff: false },
      },
    })
    expect(getGroupPolicy(cfg, "qq", "100")).toEqual({ proactiveEnabled: true })
    expect(getGroupPolicy(cfg, "tg", "-100123")).toEqual({
      notifyAdminOnHandoff: false,
    })
  })

  it("QQ 回退裸 chatId 旧键", () => {
    const cfg = baseCfg({
      groupPolicies: {
        "100": { proactiveSilenceMs: 60_000 },
      },
    })
    expect(getGroupPolicy(cfg, "qq", "100")).toEqual({
      proactiveSilenceMs: 60_000,
    })
  })

  it("TG 不回退裸 chatId", () => {
    const cfg = baseCfg({
      groupPolicies: {
        "-100123": { proactiveEnabled: true },
      },
    })
    expect(getGroupPolicy(cfg, "tg", "-100123")).toBeUndefined()
  })

  it("无策略 → undefined", () => {
    expect(getGroupPolicy(baseCfg(), "qq", "1")).toBeUndefined()
  })
})
