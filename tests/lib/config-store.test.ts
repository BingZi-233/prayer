import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig, setConfig } from "@/lib/config-store";

function mkRepo(): Repo {
  return new Repo(openDb(":memory:", 3));
}

describe("config-store", () => {
  it("无行时用 env 种子并落库", () => {
    const repo = mkRepo();
    const cfg = getConfig(repo, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "111",
      ADMIN_GROUP_ID: "222",
    });
    expect(cfg.onebotWsUrl).toBe("ws://x:1");
    expect(cfg.botQQ).toBe(111);
    // 已落库:再读(空 env)仍拿到
    const again = getConfig(repo, {});
    expect(again.botQQ).toBe(111);
  });

  it("setConfig 局部更新并持久化", () => {
    const repo = mkRepo();
    getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    setConfig(repo, { botQQ: 999 });
    const cfg = getConfig(repo, {});
    expect(cfg.botQQ).toBe(999);
    expect(cfg.onebotWsUrl).toBe("ws://x:1"); // 未改字段保留
  });

  it("默认值:handoffTimeoutMin=30, dbPath, claudeConfigDir", () => {
    const repo = mkRepo();
    const cfg = getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    expect(cfg.handoffTimeoutMin).toBe(30);
    expect(cfg.dbPath).toBe("./data/agent.db");
    expect(cfg.claudeConfigDir).toBe("./data/claude-config");
  });

  it("旧库缺字段:读取时用默认值补齐", () => {
    const repo = mkRepo();
    // 模拟老版本只存了部分字段的行
    repo.setConfigRow("app", JSON.stringify({ botQQ: 5, onebotWsUrl: "ws://old:1" }));
    const cfg = getConfig(repo, {});
    expect(cfg.botQQ).toBe(5); // 存储值优先
    expect(cfg.onebotWsUrl).toBe("ws://old:1");
    expect(cfg.claudeConfigDir).toBe("./data/claude-config"); // 缺失字段补默认
    expect(cfg.handoffTimeoutMin).toBe(30);
  });

  it("reflect 参数有默认值,env 可覆盖", () => {
    const repo = new Repo(openDb(":memory:", 3));
    const cfg = getConfig(repo, { REFLECT_SETTLE_MS: "1000" } as any);
    expect(cfg.reflectSettleMs).toBe(1000);
    expect(cfg.reflectScanMs).toBe(300000); // 默认
    expect(cfg.reflectLookbackMs).toBe(7200000);
    expect(cfg.reflectWindowMax).toBe(60);
  });

  it("反思压缩默认值 + env 覆盖", () => {
    const repo = mkRepo();
    const cfg = getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    expect(cfg.reflectCompactMs).toBe(86_400_000);
    expect(cfg.reflectCompactMinEntries).toBe(10);
    const repo2 = mkRepo();
    const cfg2 = getConfig(repo2, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
      ADMIN_GROUP_ID: "2",
      REFLECT_COMPACT_MS: "3600000",
      REFLECT_COMPACT_MIN_ENTRIES: "5",
    });
    expect(cfg2.reflectCompactMs).toBe(3_600_000);
    expect(cfg2.reflectCompactMinEntries).toBe(5);
  });

  it("enabledGroups 默认空数组", () => {
    const repo = mkRepo();
    const cfg = getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    expect(cfg.enabledGroups).toEqual([]);
  });

  it("旧库缺 enabledGroups 补空数组;setConfig 可写入", () => {
    const repo = mkRepo();
    repo.setConfigRow("app", JSON.stringify({ botQQ: 5 }));
    expect(getConfig(repo, {}).enabledGroups).toEqual([]); // 缺失补默认
    setConfig(repo, { enabledGroups: [100, 200] });
    expect(getConfig(repo, {}).enabledGroups).toEqual([100, 200]); // 存储值优先
  });

  it("reflectNotifyAdmin 默认 true;env false 关闭;setConfig 可改", () => {
    const repo = mkRepo();
    expect(getConfig(repo, {}).reflectNotifyAdmin).toBe(true);
    const repo2 = mkRepo();
    expect(getConfig(repo2, { REFLECT_NOTIFY_ADMIN: "false" }).reflectNotifyAdmin).toBe(false);
    setConfig(repo, { reflectNotifyAdmin: false });
    expect(getConfig(repo, {}).reflectNotifyAdmin).toBe(false);
  });

  it("resumeTtlMs 默认 300000;env RESUME_TTL_MS 覆盖", () => {
    const repo = mkRepo();
    expect(getConfig(repo, {}).resumeTtlMs).toBe(300000);
    const repo2 = mkRepo();
    expect(getConfig(repo2, { RESUME_TTL_MS: "120000" }).resumeTtlMs).toBe(120000);
    setConfig(repo, { resumeTtlMs: 60000 });
    expect(getConfig(repo, {}).resumeTtlMs).toBe(60000);
  });
});

describe("config-store proactive 字段", () => {
  it("无 env → proactive 默认值(默认关)", () => {
    const repo = new Repo(openDb(":memory:"));
    const cfg = getConfig(repo, {});
    expect(cfg.proactiveEnabled).toBe(false);
    expect(cfg.proactiveScanMs).toBe(60000);
    expect(cfg.proactiveSilenceMs).toBe(180000);
    expect(cfg.proactiveMaxPerScan).toBe(2);
  });

  it("env 覆盖 proactive 字段", () => {
    const repo = new Repo(openDb(":memory:"));
    const cfg = getConfig(repo, {
      PROACTIVE_ENABLED: "true",
      PROACTIVE_SCAN_MS: "30000",
      PROACTIVE_SILENCE_MS: "120000",
      PROACTIVE_MAX_PER_SCAN: "5",
    });
    expect(cfg.proactiveEnabled).toBe(true);
    expect(cfg.proactiveScanMs).toBe(30000);
    expect(cfg.proactiveSilenceMs).toBe(120000);
    expect(cfg.proactiveMaxPerScan).toBe(5);
  });
});
