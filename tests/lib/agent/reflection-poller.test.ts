import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { runScan } from "@/lib/agent/reflection-poller";

let repo: Repo;
const embed = async () => new Float32Array([1, 0, 0]); // 与 openDb(:memory:,3) 一致

// 假 query:产出单条 assistant 文本
function fakeQuery(text: string) {
  return async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text }] } };
    yield { type: "result", subtype: "success" };
  };
}

// 用固定 now 造时间带内消息:seedAt 相对 now 的偏移(ms,负数=更早)
function seed(groupId: number, userId: number, role: string, text: string, at: number) {
  (repo as any).db
    .prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
    .run(groupId, userId, role, text, at);
}

const NOW = 10_000_000;
const opts = (over: Record<string, unknown> = {}) => ({
  repo,
  adminGroupId: 999,
  embed,
  now: () => NOW,
  scanMs: 1, // 不用于 runScan
  lookbackMs: 1_000_000,
  settleMs: 1000,
  windowMax: 60,
  ...over,
});

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:", 3));
});

describe("reflection-poller runScan", () => {
  it("有效解答 → 入库 + 通知管理群 + 推进游标", async () => {
    // 已沉降带 (0, NOW-settle=9_999_000]
    seed(100, 200, "member", "退款多久到账?", NOW - 5000);
    seed(100, 201, "admin", "一般 3 个工作日", NOW - 4000);
    seed(100, 200, "member", "好的谢谢解决了", NOW - 3000);
    const notice = new Promise<any>((res) => bus.once("action.send", res));
    await runScan(
      opts({
        queryFn: fakeQuery(
          '[{"question":"退款多久到账","answer":"3个工作日","effective":true,"faq":"退款一般 3 个工作日到账"}]'
        ) as never,
      })
    );
    const a = await notice;
    expect(a.groupId).toBe(999);
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 1);
    expect(hits[0].content).toContain("退款");
    expect(hits[0].source).toContain("human-reflection:100:");
    expect(repo.groupReflectCursor(100)).toBe(NOW - 1000); // until = now - settle
  });

  it("effective=false → 不入库不通知", async () => {
    seed(100, 201, "admin", "在的亲", NOW - 4000);
    const spy = vi.fn();
    bus.on("action.send", spy);
    await runScan(opts({ queryFn: fakeQuery('[{"effective":false}]') as never }));
    expect(spy).not.toHaveBeenCalled();
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0);
  });

  it("群内无管理发言 → 不成为候选,不调用 LLM,游标不动", async () => {
    seed(100, 200, "member", "只有用户发言", NOW - 4000);
    const qf = vi.fn(fakeQuery("[]"));
    await runScan(opts({ queryFn: qf as never }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.groupReflectCursor(100)).toBe(0);
  });

  it("太新(settle 带内)的管理发言不被处理", async () => {
    // at = NOW-500 > until(NOW-1000) → 不在已沉降带
    seed(100, 201, "admin", "刚说的", NOW - 500);
    const qf = vi.fn(fakeQuery("[]"));
    await runScan(opts({ queryFn: qf as never }));
    expect(qf).not.toHaveBeenCalled();
  });

  it("LLM 输出非法 JSON → 不入库不抛", async () => {
    seed(100, 201, "admin", "答案", NOW - 4000);
    await runScan(opts({ queryFn: fakeQuery("抱歉无法处理") as never }));
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0);
    expect(repo.groupReflectCursor(100)).toBe(NOW - 1000); // 仍推进
  });

  it("until <= 群游标 → 直接跳过(不重复处理)", async () => {
    repo.setGroupReflectCursor(100, NOW); // 该群游标已在 now,until=now-settle < cursor
    seed(100, 201, "admin", "答案", NOW - 4000);
    const qf = vi.fn(fakeQuery("[]"));
    await runScan(opts({ queryFn: qf as never }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.groupReflectCursor(100)).toBe(NOW); // 不动
  });

  it("忙群:band 管理发言在大量后续消息后仍入窗(不被 evict)", async () => {
    seed(100, 200, "member", "怎么退款?", NOW - 8000); // 问题
    seed(100, 201, "admin", "在我的订单页点退款", NOW - 7000); // 管理回答(band 内)
    for (let i = 0; i < 70; i++) seed(100, 300 + i, "member", `灌水${i}`, NOW - 6000 + i);
    let captured = "";
    const qf = (args: { prompt: string }) => {
      captured = args.prompt;
      return fakeQuery("[]")();
    };
    await runScan(opts({ queryFn: qf as never, windowMax: 60 }));
    expect(captured).toContain("在我的订单页点退款"); // 回答必须出现在喂给 LLM 的转录里
  });

  it("多群:各群 band 有管理发言 → 都被处理并各沉淀一条", async () => {
    seed(100, 201, "admin", "群100答案", NOW - 4000);
    seed(200, 202, "admin", "群200答案", NOW - 4000);
    await runScan(
      opts({ queryFn: fakeQuery('[{"question":"q","answer":"a","effective":true,"faq":"通用知识条"}]') as never })
    );
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 10);
    expect(hits).toHaveLength(2);
  });

  it("单群处理抛错 → 该群游标不推进(下轮重试),其他群照常沉淀", async () => {
    seed(100, 201, "admin", "群100答案", NOW - 4000);
    seed(200, 202, "admin", "群200答案", NOW - 4000);
    // 群100 转录触发抛错;群200 正常返回有效
    const qf = (args: { prompt: string }) => {
      if (args.prompt.includes("群100答案")) throw new Error("boom");
      return fakeQuery('[{"question":"q","answer":"a","effective":true,"faq":"群200知识条"}]')();
    };
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    await runScan(opts({ queryFn: qf as never }));
    const e = await err;
    expect(e.scope).toBe("reflection");
    expect(e.groupId).toBe(100);
    expect(repo.groupReflectCursor(100)).toBe(0); // 抛错群不推进
    expect(repo.groupReflectCursor(200)).toBe(NOW - 1000); // 正常群推进
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 10)).toHaveLength(1); // 只群200沉淀
  });
});
