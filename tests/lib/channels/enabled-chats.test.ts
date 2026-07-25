import { describe, it, expect } from "vitest"
import type { AppConfig } from "@/lib/config-store"
import {
  listEnabledChats,
  isChatEnabled,
  policyKey,
  getGroupPolicy,
  resolveAdminSurface,
  isAdminSurface,
  resolveRuntimeChatConfig,
} from "@/lib/channels/enabled-chats"

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

describe("policyKey", () => {
  it("拼 channel:chatId", () => {
    expect(policyKey("qq", "100")).toBe("qq:100")
    expect(policyKey("tg", "-100123")).toBe("tg:-100123")
  })
})

describe("listEnabledChats", () => {
  it("返回 enabledChats", () => {
    const cfg = baseCfg({
      enabledChats: [
        { channel: "qq", chatId: "111" },
        { channel: "qq", chatId: "222" },
        { channel: "tg", chatId: "-100123" },
        { channel: "tg", chatId: "42" },
      ],
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
    expect(listEnabledChats({})).toEqual([])
  })
})

describe("resolveAdminSurface / isAdminSurface", () => {
  it("显式 adminSurface", () => {
    expect(
      resolveAdminSurface({
        adminSurface: { channel: "tg", chatId: "-1" },
      })
    ).toEqual({ channel: "tg", chatId: "-1" })
  })

  it("null / 缺省 → null", () => {
    expect(resolveAdminSurface({ adminSurface: null })).toBeNull()
    expect(resolveAdminSurface({})).toBeNull()
  })

  it("isAdminSurface 精确匹配 channel+chatId", () => {
    const s = { channel: "qq" as const, chatId: "999" }
    expect(isAdminSurface(s, "qq", "999")).toBe(true)
    expect(isAdminSurface(s, "qq", "1")).toBe(false)
    expect(isAdminSurface(s, "tg", "999")).toBe(false)
    expect(isAdminSurface(null, "qq", "999")).toBe(false)
  })
})

describe("resolveRuntimeChatConfig", () => {
  it("一次解析 enabledChats + adminSurface", () => {
    const r = resolveRuntimeChatConfig(
      baseCfg({
        enabledChats: [
          { channel: "qq", chatId: "10" },
          { channel: "tg", chatId: "-100" },
        ],
        adminSurface: { channel: "qq", chatId: "7" },
      })
    )
    expect(r.enabledChats).toEqual([
      { channel: "qq", chatId: "10" },
      { channel: "tg", chatId: "-100" },
    ])
    expect(r.adminSurface).toEqual({ channel: "qq", chatId: "7" })
  })
})

describe("isChatEnabled", () => {
  it("QQ chatId 命中", () => {
    const cfg = baseCfg({
      enabledChats: [
        { channel: "qq", chatId: "100" },
        { channel: "qq", chatId: "200" },
      ],
    })
    expect(isChatEnabled(cfg, "qq", "100")).toBe(true)
    expect(isChatEnabled(cfg, "qq", "200")).toBe(true)
    expect(isChatEnabled(cfg, "qq", "999")).toBe(false)
  })

  it("TG chatId 字符串比较（含负 id）", () => {
    const cfg = baseCfg({
      enabledChats: [
        { channel: "tg", chatId: "-100123456" },
        { channel: "tg", chatId: "42" },
      ],
    })
    expect(isChatEnabled(cfg, "tg", "-100123456")).toBe(true)
    expect(isChatEnabled(cfg, "tg", "42")).toBe(true)
    expect(isChatEnabled(cfg, "tg", "100123456")).toBe(false)
    expect(isChatEnabled(cfg, "tg", "-100123456.0")).toBe(false)
  })

  it("其它通道 / 错通道不命中", () => {
    const cfg = baseCfg({
      enabledChats: [
        { channel: "qq", chatId: "100" },
        { channel: "tg", chatId: "-100" },
      ],
    })
    expect(isChatEnabled(cfg, "tg", "100")).toBe(false)
    expect(isChatEnabled(cfg, "qq", "-100")).toBe(false)
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
