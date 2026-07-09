import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { runCompact, validateCompacted } from "@/lib/agent/reflection-compactor";

let repo: Repo;
const vec = () => new Float32Array([1, 0, 0]);
const embed = async () => vec();

function fakeQuery(text: string) {
  return () =>
    (async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text }] } };
      yield { type: "result", subtype: "success" };
    })();
}

function seedReflections(n: number) {
  for (let i = 0; i < n; i++) {
    repo.insertKbEntry("human-reflection", `反思${i}`, `human-reflection:100:${i}`, vec());
  }
}

const opts = (over: Record<string, unknown> = {}) => ({
  repo,
  adminGroupId: 999,
  embed,
  now: () => 7_000_000,
  minEntries: 3,
  ...over,
});

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:", 3));
});

describe("runCompact", () => {
  it("少于 minEntries → 跳过,不调 LLM,库不变", async () => {
    seedReflections(2);
    const qf = vi.fn(fakeQuery("[]"));
    await runCompact(opts({ queryFn: qf as never, minEntries: 3 }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.reflectionEntries()).toHaveLength(2);
  });

  it("正常整理 → 库被替换为新集 + 通知管理群 + source 为 gid 0", async () => {
    seedReflections(5);
    const notice = new Promise<any>((res) => bus.once("action.send", res));
    await runCompact(
      opts({ queryFn: fakeQuery('[{"faq":"合并后的条目A"},{"faq":"合并后的条目B"}]') as never })
    );
    const a = await notice;
    expect(a.groupId).toBe(999);
    expect(a.text).toContain("5 → 2");
    const refs = repo.reflectionEntries();
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.content).sort()).toEqual(["合并后的条目A", "合并后的条目B"]);
    expect(refs.every((r) => r.groupId === 0 && r.ts === 7_000_000)).toBe(true);
  });

  it("notifyAdmin=false → 整理成功但不通知管理群", async () => {
    seedReflections(5);
    const spy = vi.fn();
    bus.on("action.send", spy);
    await runCompact(
      opts({
        notifyAdmin: false,
        queryFn: fakeQuery('[{"faq":"合并后的条目A"},{"faq":"合并后的条目B"}]') as never,
      })
    );
    expect(spy).not.toHaveBeenCalled();
    expect(repo.reflectionEntries()).toHaveLength(2);
  });

  it("整理成功 → 写入 reflect_compactions 记录(before/after 快照)", async () => {
    seedReflections(5);
    await runCompact(opts({ queryFn: fakeQuery('[{"faq":"合并A"},{"faq":"合并B"}]') as never }));
    const recs = repo.recentCompactions(10);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ ts: 7_000_000, beforeCount: 5, afterCount: 2 });
    expect(recs[0].before.sort()).toEqual(["反思0", "反思1", "反思2", "反思3", "反思4"]);
    expect(recs[0].after.sort()).toEqual(["合并A", "合并B"]);
  });

  it("整理失败(空集)→ 不写整理记录", async () => {
    seedReflections(5);
    bus.on("error.occurred", () => {});
    await runCompact(opts({ queryFn: fakeQuery("[]") as never }));
    expect(repo.recentCompactions(10)).toHaveLength(0);
  });

  it("安全底线:空数组 → 保留旧库 + emit error,不替换", async () => {
    seedReflections(5);
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    const spy = vi.fn();
    bus.on("action.send", spy);
    await runCompact(opts({ queryFn: fakeQuery("[]") as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(5);
    expect(spy).not.toHaveBeenCalled();
  });

  it("安全底线:非法 JSON → 保留旧库", async () => {
    seedReflections(5);
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    const spy = vi.fn();
    bus.on("action.send", spy);
    await runCompact(opts({ queryFn: fakeQuery("抱歉无法处理") as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(5);
    expect(spy).not.toHaveBeenCalled();
  });

  it("安全底线:条目暴涨(> 输入 ×1.5)→ 保留旧库", async () => {
    seedReflections(4);
    const arr = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ faq: `x${i}` })));
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    const spy = vi.fn();
    bus.on("action.send", spy);
    await runCompact(opts({ queryFn: fakeQuery(arr) as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(4);
    expect(spy).not.toHaveBeenCalled();
  });

  it("基础上下文:去重后的基础片段注入 prompt(同一 chunk 只出现一次)", async () => {
    seedReflections(3); // 3 条反思,同一向量都最近邻到同一基础 chunk
    repo.insertKbEntry("faq/x.md", "基础片段X", "faq/x.md", vec());
    let captured = "";
    const qf = (args: { prompt: string }) => {
      captured = args.prompt;
      return fakeQuery('[{"faq":"甲"}]')();
    };
    await runCompact(opts({ queryFn: qf as never }));
    expect(captured).toContain("【权威基础文档片段】");
    expect(captured).toContain("基础片段X");
    expect(captured.split("基础片段X").length - 1).toBe(1); // 去重:只一次
  });

  it("旁路:context 阶段 embed 抛错 → emit error,不抛不替换", async () => {
    seedReflections(5);
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    let n = 0;
    const throwingEmbed = async () => {
      if (n++ === 0) throw new Error("embed boom");
      return vec();
    };
    await runCompact(opts({ embed: throwingEmbed as never, queryFn: fakeQuery("[]") as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(5);
  });

  it("对已压缩集(gid 0)再跑一轮不报错,产出替换成功", async () => {
    // 首轮:5 → 2
    seedReflections(5);
    await runCompact(opts({ queryFn: fakeQuery('[{"faq":"甲"},{"faq":"乙"}]') as never }));
    expect(repo.reflectionEntries()).toHaveLength(2);
    // 次轮:2 条(< minEntries 3)→ 跳过,不变
    const qf = vi.fn(fakeQuery('[{"faq":"甲"}]'));
    await runCompact(opts({ queryFn: qf as never, minEntries: 3 }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.reflectionEntries()).toHaveLength(2);
  });
});

describe("validateCompacted", () => {
  it("正常 → 返回 trim 后非空 faq 列表", () => {
    expect(validateCompacted('[{"faq":" a "},{"faq":"b"}]', 3)).toEqual(["a", "b"]);
  });
  it("非数组 / 非法 → null", () => {
    expect(validateCompacted("不是JSON", 3)).toBeNull();
    expect(validateCompacted('{"faq":"a"}', 3)).toBeNull();
  });
  it("空集而输入非空 → null", () => {
    expect(validateCompacted("[]", 5)).toBeNull();
  });
  it("暴涨 > ×1.5 → null", () => {
    const arr = JSON.stringify(Array.from({ length: 7 }, () => ({ faq: "x" })));
    expect(validateCompacted(arr, 4)).toBeNull();
  });
  it("过滤空白 faq 后仍有内容 → 返回过滤结果", () => {
    expect(validateCompacted('[{"faq":"a"},{"faq":"  "},{"faq":""}]', 3)).toEqual(["a"]);
  });
});

describe("registerReflectionCompactor 防重入", () => {
  it("上一轮未结束时下一 tick 跳过", async () => {
    const { registerReflectionCompactor } = await import("@/lib/agent/reflection-compactor");
    vi.useFakeTimers();
    try {
      seedReflections(5);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const qf = vi.fn(() =>
        (async function* () {
          await gate;
          yield { type: "assistant", message: { content: [{ type: "text", text: "[]" }] } };
        })()
      );
      const stop = registerReflectionCompactor(opts({ compactMs: 1000, queryFn: qf as never }));
      await vi.advanceTimersByTimeAsync(1000); // tick1:启动,卡 gate
      expect(qf).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000); // tick2:running=true → 跳过
      expect(qf).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("registerReflectionCompactor 到期判定 + 持久游标(修复重启清零)", () => {
  it("首刷:装配后延迟 firstDelayMs 到期即跑一次(不必等满 scanMs)", async () => {
    const { registerReflectionCompactor } = await import("@/lib/agent/reflection-compactor");
    vi.useFakeTimers();
    try {
      seedReflections(5);
      const qf = vi.fn(fakeQuery('[{"faq":"甲"},{"faq":"乙"}]'));
      // compactMs 大(1h),但 compactAt=0 → now-0 已到期;首刷延迟 50ms
      const stop = registerReflectionCompactor(
        opts({ compactMs: 3_600_000, scanMs: 3_600_000, firstDelayMs: 50, queryFn: qf as never })
      );
      await vi.advanceTimersByTimeAsync(50);
      expect(qf).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("未到期:now-compactAt < compactMs → 跳过不跑", async () => {
    const { registerReflectionCompactor } = await import("@/lib/agent/reflection-compactor");
    vi.useFakeTimers();
    try {
      seedReflections(5);
      repo.setCompactAt(7_000_000 - 500); // 距 now(7_000_000)仅 500 < compactMs 1000
      const qf = vi.fn(fakeQuery("[]"));
      const stop = registerReflectionCompactor(
        opts({ compactMs: 1000, scanMs: 1000, firstDelayMs: 10, queryFn: qf as never })
      );
      await vi.advanceTimersByTimeAsync(2000);
      expect(qf).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("重启补跑:游标陈旧(距 now ≥ compactMs)→ 到期跑,并推进游标到 now", async () => {
    const { registerReflectionCompactor } = await import("@/lib/agent/reflection-compactor");
    vi.useFakeTimers();
    try {
      seedReflections(5);
      repo.setCompactAt(7_000_000 - 5000); // 陈旧游标,> compactMs 1000
      const qf = vi.fn(fakeQuery('[{"faq":"甲"},{"faq":"乙"}]'));
      const stop = registerReflectionCompactor(
        opts({ compactMs: 1000, scanMs: 1000, firstDelayMs: 10, queryFn: qf as never })
      );
      await vi.advanceTimersByTimeAsync(10); // 首刷即到期
      expect(qf).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(repo.compactAt()).toBe(7_000_000); // 无论成败游标推进到 now
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
