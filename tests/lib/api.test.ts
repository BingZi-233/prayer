import { describe, it, expect } from "vitest";
import { ok, fail, maskConfig } from "@/lib/api";
import type { AppConfig } from "@/lib/config-store";

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "secret-token-9999",
  botQQ: 1,
  extraAtQQs: [],
  adminGroupId: 2,
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
  proactiveEnabled: false,
  proactiveScanMs: 60000,
  proactiveSilenceMs: 180000,
  proactiveMaxPerScan: 2,
  supportUrl: "https://www.packyapi.com",
  ackEnabled: true,
  maxReplyChars: 900,
  usageBudgetUsd: 0,
  groupPolicies: {},
};

describe("api helpers", () => {
  it("ok 包 data", () => expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } }));
  it("fail 包 error", () => expect(fail("boom")).toEqual({ ok: false, error: "boom" }));
  it("maskConfig 掩码 token", () => {
    const m = maskConfig(cfg);
    expect(m.onebotAccessToken).toBe("••••9999");
    expect(m.onebotWsUrl).toBe("ws://x:1"); // 非 secret 不动
  });
});
