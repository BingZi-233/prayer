import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { SessionStore } from "@/lib/agent/session";
import { runScan } from "@/lib/agent/unanswered-poller";

let repo: Repo;
const NOW = 10_000_000;

function seed(groupId: number, userId: number, role: string | null, text: string, at: number) {
  (repo as any).db
    .prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
    .run(groupId, userId, role, text, at);
}

// 假 agent:返回固定文本 + sessionId
const fakeAgent = (text: string, sessionId = "sess-x") => ({
  run: vi.fn(async () => ({ text, sessionId })),
});

const base = (over: Record<string, unknown> = {}) => ({
  repo,
  store: new SessionStore(repo, 0),
  classify: async () => true,        // 默认判官放行
  adminGroupId: 999,
  enabledGroups: [100],
  silenceMs: 1000,                   // until = NOW-1000
  maxPerScan: 2,
  now: () => NOW,
  agent: fakeAgent("这是答案") as never,
  ...over,
});

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
});

describe("unanswered-poller runScan", () => {
  it("happy path:沉降未应答问题 → 发 reply + 写回 session + 推进游标", async () => {
    repo.setGroupProactiveCursor(100, 1); // 非冷启动
    seed(100, 200, "member", "claude 价格?", NOW - 5000);
    const agent = fakeAgent("cc 组每百万 token 20 美元", "sess-1");
    const reply = new Promise<any>((res) => bus.once("reply.ready", res));
    await runScan(base({ agent: agent as never }));
    const r = await reply;
    expect(r.groupId).toBe(100);
    expect(r.text).toContain("20 美元");
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(repo.sessionUpdatedAt("100:200")).toBeGreaterThan(0); // remember 写回
    expect(repo.groupProactiveCursor(100)).toBe(NOW - 1000);
  });

  it("冷启动(游标==0):设为 until 并跳过,不答积压", async () => {
    seed(100, 200, "member", "价格?", NOW - 5000);
    const agent = fakeAgent("答案");
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: agent as never }));
    expect(agent.run).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(repo.groupProactiveCursor(100)).toBe(NOW - 1000);
  });

  it("压制①人工接管:问题后有 admin 发言 → 沉默", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    seed(100, 201, "admin", "cc 组 20 美元", NOW - 4000);
    const agent = fakeAgent("答案");
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: agent as never }));
    expect(agent.run).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("压制②主链路已处理:session.updated_at > 问题 ts → 沉默", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    repo.setSessionId("100:200", "已 @处理"); // updated_at ≈ 真实 now >> 问题 ts
    const agent = fakeAgent("答案");
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: agent as never }));
    expect(agent.run).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("门1 判官=false → 不进 agent、不发", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "今天天气?", NOW - 5000);
    const agent = fakeAgent("答案");
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: agent as never, classify: async () => false }));
    expect(agent.run).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("哨兵:agent 输出 __NO_ANSWER__ → 沉默、不写回 session", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "冷门问题?", NOW - 5000);
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: fakeAgent("__NO_ANSWER__") as never }));
    expect(spy).not.toHaveBeenCalled();
    expect(repo.sessionUpdatedAt("100:200")).toBeUndefined();
  });

  it("agent 空输出 → 沉默", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "问题?", NOW - 5000);
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: fakeAgent("   ") as never }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("太新(> until)消息不处理", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "刚问的", NOW - 500); // > until = NOW-1000
    const agent = fakeAgent("答案");
    await runScan(base({ agent: agent as never }));
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("maxPerScan:每群每轮命中不超过上限", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "问题A", NOW - 5000);
    seed(100, 201, "member", "问题B", NOW - 4900);
    seed(100, 202, "member", "问题C", NOW - 4800);
    const agent = fakeAgent("答案");
    await runScan(base({ agent: agent as never, maxPerScan: 2 }));
    expect(agent.run).toHaveBeenCalledTimes(2);
  });

  it("非生效群:即使有沉降提问也跳过", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    const agent = fakeAgent("答案");
    await runScan(base({ agent: agent as never, enabledGroups: [] }));
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("单群抛错 → emit error.occurred(scope=proactive),不炸整轮", async () => {
    repo.setGroupProactiveCursor(100, 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    const boom = { run: vi.fn(async () => { throw new Error("boom"); }) };
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    await runScan(base({ agent: boom as never }));
    const e = await err;
    expect(e.scope).toBe("proactive");
    expect(e.groupId).toBe(100);
  });
});
