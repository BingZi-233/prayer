import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { SessionStore } from "@/lib/agent/session";
import { runScan } from "@/lib/agent/unanswered-poller";
import { AGENT_FALLBACK_TEXT } from "@/lib/agent/agent";
import {
  setTgBypassBlocked,
  _resetTgBypassStateForTests,
} from "@/lib/channels/tg/bypass-state";

let repo: Repo;
const NOW = 10_000_000;

function seed(groupId: number, userId: number, role: string | null, text: string, at: number, messageId?: number) {
  (repo as any).db
    .prepare("INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at,message_id) VALUES (?,?,?,?,?,?,?)")
    .run("qq", String(groupId), String(userId), role, text, at, messageId != null ? String(messageId) : null);
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
  _resetTgBypassStateForTests();
  repo = new Repo(openDb(":memory:"));
});

describe("unanswered-poller runScan", () => {
  it("happy path:沉降未应答问题 → 发 reply + 写回 session + 推进游标", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1); // 非冷启动
    seed(100, 200, "member", "claude 价格?", NOW - 5000);
    const agent = fakeAgent("cc 组每百万 token 20 美元", "sess-1");
    const reply = new Promise<any>((res) => bus.once("reply.ready", res));
    await runScan(base({ agent: agent as never }));
    const r = await reply;
    expect(r.channel).toBe("qq");
    expect(r.chatId).toBe("100");
    expect(r.text).toContain("20 美元");
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(repo.sessionUpdatedAt("qq:100:200")).toBeGreaterThan(0); // remember 写回
    expect(repo.groupProactiveCursor("qq", "100")).toBe(NOW - 1000);
    // 命中留痕:库里 1 条,内容为问题原料 + agent 答案
    expect(repo.proactiveTotalCount()).toBe(1);
    const rec = repo.proactiveReplies(10);
    expect(rec[0]).toMatchObject({ channel: "qq", chatId: "100", userId: "200", question: "claude 价格?", answer: "cc 组每百万 token 20 美元" });
  });

  it("主动回复引用用户代表消息(band 内最后一条)", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "第一句", NOW - 6000, 501);
    seed(100, 200, "member", "第二句?", NOW - 5000, 502); // band 内最后一条 → 代表
    const reply = new Promise<any>((res) => bus.once("reply.ready", res));
    await runScan(base());
    const r = await reply;
    expect(r.replyToId).toBe("502");
  });

  it("沉默(哨兵/空/降级)不写库", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    await runScan(base({ agent: fakeAgent("__NO_ANSWER__") as never }));
    expect(repo.proactiveTotalCount()).toBe(0);
  });

  it("冷启动(游标==0):设为 until 并跳过,不答积压", async () => {
    seed(100, 200, "member", "价格?", NOW - 5000);
    const agent = fakeAgent("答案");
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: agent as never }));
    expect(agent.run).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(repo.groupProactiveCursor("qq", "100")).toBe(NOW - 1000);
  });

  it("压制①人工接管:问题后有 admin 发言 → 沉默", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
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
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    repo.setSessionId("qq:100:200", "已 @处理"); // updated_at ≈ 真实 now >> 问题 ts
    const agent = fakeAgent("答案");
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: agent as never }));
    expect(agent.run).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("门1 判官=false → 不进 agent、不发", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "今天天气?", NOW - 5000);
    const agent = fakeAgent("答案");
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: agent as never, classify: async () => false }));
    expect(agent.run).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("哨兵:agent 输出 __NO_ANSWER__ → 沉默、不写回 session", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "冷门问题?", NOW - 5000);
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: fakeAgent("__NO_ANSWER__") as never }));
    expect(spy).not.toHaveBeenCalled();
    expect(repo.sessionUpdatedAt("qq:100:200")).toBeUndefined();
  });

  it("agent 空输出 → 沉默", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "问题?", NOW - 5000);
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: fakeAgent("   ") as never }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("agent 降级兜底文案(非抛错)→ 沉默、不写回 session", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "问题?", NOW - 5000);
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: fakeAgent(AGENT_FALLBACK_TEXT) as never }));
    expect(spy).not.toHaveBeenCalled();
    expect(repo.sessionUpdatedAt("qq:100:200")).toBeUndefined();
  });

  it("太新(> until)消息不处理", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "刚问的", NOW - 500); // > until = NOW-1000
    const agent = fakeAgent("答案");
    await runScan(base({ agent: agent as never }));
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("maxPerScan:每群每轮命中不超过上限", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "问题A", NOW - 5000);
    seed(100, 201, "member", "问题B", NOW - 4900);
    seed(100, 202, "member", "问题C", NOW - 4800);
    const agent = fakeAgent("答案");
    await runScan(base({ agent: agent as never, maxPerScan: 2 }));
    expect(agent.run).toHaveBeenCalledTimes(2);
  });

  it("非生效群:即使有沉降提问也跳过", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    const agent = fakeAgent("答案");
    await runScan(base({ agent: agent as never, enabledGroups: [] }));
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("命中 maxPerScan 上限 → 不推进游标(溢出下轮再答,不丢弃)", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "问题A", NOW - 5000);
    seed(100, 201, "member", "问题B", NOW - 4900);
    seed(100, 202, "member", "问题C", NOW - 4800);
    await runScan(base({ agent: fakeAgent("答案") as never, maxPerScan: 2 }));
    expect(repo.groupProactiveCursor("qq", "100")).toBe(1); // 未推进
  });

  it("全部候选被压制 → 无 reply,但游标仍推进(不重复扫)", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    seed(100, 201, "admin", "已答", NOW - 4000); // 压制①
    const spy = vi.fn();
    bus.on("reply.ready", spy);
    await runScan(base({ agent: fakeAgent("答案") as never }));
    expect(spy).not.toHaveBeenCalled();
    expect(repo.groupProactiveCursor("qq", "100")).toBe(NOW - 1000); // 推进
  });

  it("单群抛错 → emit error.occurred(scope=proactive),不炸整轮", async () => {
    repo.setGroupProactiveCursor("qq", "100", 1);
    seed(100, 200, "member", "价格?", NOW - 5000);
    const boom = { run: vi.fn(async () => { throw new Error("boom"); }) };
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    await runScan(base({ agent: boom as never }));
    const e = await err;
    expect(e.scope).toBe("proactive");
    expect(e.chatId).toBe("100");
    expect(e.channel).toBe("qq");
  });

  it("TG bypass 关闭时跳过该 chat，不调 agent", async () => {
    setTgBypassBlocked("-1001", "admins-failed");
    ;(repo as any).db
      .prepare(
        "INSERT INTO group_messages (channel,group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?,?)"
      )
      .run("tg", "-1001", "200", "member", "价格?", NOW - 5000);
    repo.setGroupProactiveCursor("tg", "-1001", 1);
    const agent = fakeAgent("答案");
    await runScan(
      base({
        agent: agent as never,
        enabledGroups: [],
        telegramEnabledChats: ["-1001"],
      })
    );
    expect(agent.run).not.toHaveBeenCalled();
    expect(repo.groupProactiveCursor("tg", "-1001")).toBe(1);
  });
});
