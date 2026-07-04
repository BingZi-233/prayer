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
    setConfig(repo, { botQQ: 999, model: "claude-opus-4-8" });
    const cfg = getConfig(repo, {});
    expect(cfg.botQQ).toBe(999);
    expect(cfg.model).toBe("claude-opus-4-8");
    expect(cfg.onebotWsUrl).toBe("ws://x:1"); // 未改字段保留
  });

  it("默认值:handoffTimeoutMin=30, model, dbPath, claudeConfigDir", () => {
    const repo = mkRepo();
    const cfg = getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    expect(cfg.handoffTimeoutMin).toBe(30);
    expect(cfg.model).toBe("claude-sonnet-5");
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
    expect(cfg.model).toBe("claude-sonnet-5");
  });
});
