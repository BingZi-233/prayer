import { describe, it, expect } from "vitest"
import { ok, fail, maskConfig } from "@/lib/core/api"
import type { AppConfig } from "@/lib/core/config-store"

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "secret-token-9999",
  botQQ: 1,
  extraAtQQs: [],
  adminSurface: { channel: "qq", chatId: "2" },
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
  telegramBotToken: "tg-secret-1234",
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
}

describe("api helpers", () => {
  it("ok 包 data", () =>
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } }))
  it("fail 包 error", () =>
    expect(fail("boom")).toEqual({ ok: false, error: "boom" }))
  it("maskConfig 掩码 token", () => {
    const m = maskConfig(cfg)
    expect(m.onebotAccessToken).toBe("••••9999")
    expect(m.telegramBotToken).toBe("••••1234")
    expect(m.onebotWsUrl).toBe("ws://x:1") // 非 secret 不动
  })
})
