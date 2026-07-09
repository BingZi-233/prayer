import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeManager, type RuntimeBuilders } from "@/lib/runtime";
import type { AppConfig } from "@/lib/config-store";

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "",
  botQQ: 1,
  adminGroupId: 2,
  enabledGroups: [],
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
  reflectNotifyAdmin: true,
  resumeTtlMs: 300000,
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

  it("stop 调用 teardown 但不关闭 DB(连接由 sharedDb 进程级持有)", () => {
    let teardowns = 0;
    let closes = 0;
    const b = fakeBuilders({
      openDb: () => ({ close: () => { closes++; } }) as never,
      assemble: () => () => { teardowns++; },
    });
    m.start(cfg, b);
    m.stop();
    expect(teardowns).toBe(1);
    expect(closes).toBe(0); // reconfigure/stop 不关共享连接:避免切断 in-flight scanOnce
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

  it("getGroups 委托 client.getGroupList", async () => {
    const b = fakeBuilders({
      makeClient: () => ({
        start() {}, stop() {}, isConnected: () => true,
        getGroupList: async () => [{ group_id: 111, group_name: "群甲" }],
      }) as never,
    });
    m.start(cfg, b);
    const list = await m.getGroups();
    expect(list).toEqual([{ group_id: 111, group_name: "群甲" }]);
  });

  it("未 start → getGroups 返回 undefined", async () => {
    expect(await m.getGroups()).toBeUndefined();
  });

  it("client 无 getGroupList → getGroups 返回 undefined", async () => {
    m.start(cfg, fakeBuilders()); // fakeBuilders 的 client 无 getGroupList
    expect(await m.getGroups()).toBeUndefined();
  });

  it("getGroupMembers 委托 client.getGroupMemberList", async () => {
    const b = fakeBuilders({
      makeClient: () => ({
        start() {}, stop() {}, isConnected: () => true,
        getGroupMemberList: async (g: number) => [{ user_id: 5, card: "小明", group_id: g }],
      }) as never,
    });
    m.start(cfg, b);
    const list = await m.getGroupMembers(111);
    expect(list).toEqual([{ user_id: 5, card: "小明", group_id: 111 }]);
  });

  it("client 无 getGroupMemberList → getGroupMembers 返回 undefined", async () => {
    m.start(cfg, fakeBuilders());
    expect(await m.getGroupMembers(111)).toBeUndefined();
  });

  it("assemble 收到 resumeTtlMs", () => {
    let got: { resumeTtlMs?: number } | undefined;
    m.start(
      { ...cfg, resumeTtlMs: 120000 },
      fakeBuilders({
        assemble: (args) => {
          got = args;
          return () => {};
        },
      })
    );
    expect(got?.resumeTtlMs).toBe(120000);
  });
});
