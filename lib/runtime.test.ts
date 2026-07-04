import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeManager, type RuntimeBuilders } from "./runtime";
import type { AppConfig } from "./config-store";

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "",
  botQQ: 1,
  adminGroupId: 2,
  handoffTimeoutMin: 30,
  dbPath: ":memory:",
  claudeConfigDir: "/tmp/cfgdir-test",
  model: "claude-sonnet-5",
};

function fakeBuilders(overrides: Partial<RuntimeBuilders> = {}): RuntimeBuilders {
  const client = {
    started: false,
    stopped: false,
    conn: false,
    start() { this.started = true; },
    stop() { this.stopped = true; },
    isConnected() { return this.conn; },
  };
  return {
    openDb: () => ({}) as never,
    makeRepo: () => ({ countSessions: () => 3, openTickets: () => [{}, {}] }) as never,
    makeAgent: () => ({}) as never,
    assemble: () => () => {},
    makeClient: () => client as never,
    ...overrides,
  };
}

describe("RuntimeManager", () => {
  let m: RuntimeManager;
  beforeEach(() => {
    m = new RuntimeManager();
  });

  it("初始 stopped", () => {
    expect(m.getStatus().state).toBe("stopped");
  });

  it("start 后 running,getStatus 汇报会话数与队列", () => {
    m.start(cfg, fakeBuilders());
    const s = m.getStatus();
    expect(s.state).toBe("running");
    expect(s.sessionCount).toBe(3);
    expect(s.handoffQueue).toBe(2);
    expect(typeof s.bootedAt).toBe("number");
  });

  it("start 时设置 CLAUDE_CONFIG_DIR", () => {
    m.start(cfg, fakeBuilders());
    expect(process.env.CLAUDE_CONFIG_DIR).toBe("/tmp/cfgdir-test");
  });

  it("makeClient.start 抛错 → error 态 + lastError", () => {
    const b = fakeBuilders({
      makeClient: () => ({ start() { throw new Error("boom"); }, stop() {}, isConnected: () => false }) as never,
    });
    m.start(cfg, b);
    const s = m.getStatus();
    expect(s.state).toBe("error");
    expect(s.lastError).toContain("boom");
  });

  it("reconfigure 先 stop 旧再 start 新", () => {
    let stops = 0;
    const client = { start() {}, stop() { stops++; }, isConnected: () => false };
    const b = fakeBuilders({ makeClient: () => client as never });
    m.start(cfg, b);
    m.reconfigure({ ...cfg, botQQ: 9 }, b);
    expect(stops).toBeGreaterThanOrEqual(1);
    expect(m.getStatus().state).toBe("running");
  });

  it("stop/reconfigure 调用 assemble 返回的 teardown 并关闭 DB", () => {
    let teardowns = 0;
    let closes = 0;
    const b = fakeBuilders({
      openDb: () => ({ close: () => { closes++; } }) as never,
      assemble: () => () => { teardowns++; },
    });
    m.start(cfg, b);
    m.stop();
    expect(teardowns).toBe(1);
    expect(closes).toBe(1);
    expect(m.getStatus().state).toBe("stopped");
  });

  it("start 抛错时回收半装配资源(teardown 被调用)", () => {
    let teardowns = 0;
    const b = fakeBuilders({
      assemble: () => () => { teardowns++; },
      makeClient: () => ({ start() { throw new Error("boom"); }, stop() {}, isConnected: () => false }) as never,
    });
    m.start(cfg, b);
    expect(m.getStatus().state).toBe("error");
    expect(teardowns).toBe(1); // teardown 在 catch 里被调用,不泄漏
  });
});
