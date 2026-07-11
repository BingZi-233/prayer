import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import {
  runCompact,
  validateCompacted,
  validateCompactedDetailed,
  COMPACT_OUTPUT_SCHEMA,
  COMPLETE_MIN_RATIO,
} from "@/lib/agent/reflection-compactor";

let repo: Repo;
const vec = () => new Float32Array([1, 0, 0]);
const embed = async () => vec();

function fakeQuery(text: string, structured?: unknown) {
  return () =>
    (async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text }] } };
      yield {
        type: "result",
        subtype: "success",
        ...(structured !== undefined ? { structured_output: structured } : {}),
      };
    })();
}

function seedReflections(n: number) {
  for (let i = 0; i < n; i++) {
    repo.insertKbEntry("human-reflection", `反思${i}`, `human-reflection:100:${i}`, vec());
  }
}

// 产出 n 条 FAQ 的 JSON(满足 COMPLETE_MIN_RATIO,用于正常整理用例)
function faqsJson(n: number, prefix = "合并") {
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({ faq: `${prefix}${i}` })));
}
function faqsItems(n: number, prefix = "合并") {
  return { items: Array.from({ length: n }, (_, i) => ({ faq: `${prefix}${i}` })) };
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
    // 5 条 → 4 条(≥ 70% 下限),模拟近义合并 1 对
    await runCompact(opts({ queryFn: fakeQuery(faqsJson(4)) as never }));
    const a = await notice;
    expect(a.groupId).toBe(999);
    expect(a.text).toContain("5 → 4");
    const refs = repo.reflectionEntries();
    expect(refs).toHaveLength(4);
    expect(refs.map((r) => r.content).sort()).toEqual(["合并0", "合并1", "合并2", "合并3"]);
    expect(refs.every((r) => r.groupId === 0 && r.ts === 7_000_000)).toBe(true);
  });

  it("query 带 outputFormat.json_schema + 优先用 structured_output", async () => {
    seedReflections(5);
    let captured: { options?: { outputFormat?: unknown } } | undefined;
    const qf = (args: { options?: { outputFormat?: unknown } }) => {
      captured = args;
      return fakeQuery("", faqsItems(4, "结构化"))();
    };
    await runCompact(opts({ queryFn: qf as never }));
    expect(captured?.options?.outputFormat).toEqual({
      type: "json_schema",
      schema: COMPACT_OUTPUT_SCHEMA,
    });
    expect(repo.reflectionEntries().map((r) => r.content).sort()).toEqual([
      "结构化0",
      "结构化1",
      "结构化2",
      "结构化3",
    ]);
  });

  it("notifyAdmin=false → 整理成功但不通知管理群", async () => {
    seedReflections(5);
    const spy = vi.fn();
    bus.on("action.send", spy);
    await runCompact(
      opts({
        notifyAdmin: false,
        queryFn: fakeQuery(faqsJson(4)) as never,
      })
    );
    expect(spy).not.toHaveBeenCalled();
    expect(repo.reflectionEntries()).toHaveLength(4);
  });

  it("整理成功 → 写入 reflect_compactions 记录(before/after 快照)", async () => {
    seedReflections(5);
    await runCompact(opts({ queryFn: fakeQuery(faqsJson(4, "合并")) as never }));
    const recs = repo.recentCompactions(10);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ ts: 7_000_000, beforeCount: 5, afterCount: 4 });
    expect(recs[0].before.sort()).toEqual(["反思0", "反思1", "反思2", "反思3", "反思4"]);
    expect(recs[0].after.sort()).toEqual(["合并0", "合并1", "合并2", "合并3"]);
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

  it("安全底线:完整产出低于 COMPLETE_MIN_RATIO → 保留旧库", async () => {
    seedReflections(10);
    // 10 → 2 闭合完整但远低于 70% 下限
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    await runCompact(opts({ queryFn: fakeQuery(faqsJson(2)) as never }));
    expect((await err).err.message).toMatch(/过度删除|下限/);
    expect(repo.reflectionEntries()).toHaveLength(10);
  });

  it("截断+嵌套 source 数组:完整对象够下限 → salvage 应用", async () => {
    // 复现线上:LLM 加 source 字段后输出被截断;旧贪婪 /\[...\]/ 吃到嵌套 ] 解析失败
    // 截断路径用 TRUNCATED_MIN_RATIO=0.2,5 条 floor=1,2 条可过
    seedReflections(5);
    const truncated =
      '[{"faq":"支付方式展示","source":["1"]},{"faq":"auth.json 与 apikey","source":["2","7"]},{"faq":"机器人知识库尚未';
    const notice = new Promise<any>((res) => bus.once("action.send", res));
    await runCompact(opts({ queryFn: fakeQuery(truncated) as never }));
    const a = await notice;
    expect(a.text).toContain("5 → 2");
    const refs = repo.reflectionEntries();
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.content).sort()).toEqual(["auth.json 与 apikey", "支付方式展示"]);
  });

  it("截断 salvage 条数过少(< 输入×0.2)→ 保留旧库", async () => {
    seedReflections(10);
    // 仅 1 条完整 + 半截 → floor=ceil(10*0.2)=2 → 拒
    const truncated = '[{"faq":"仅一条完整","source":["1"]},{"faq":"半截';
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    await runCompact(opts({ queryFn: fakeQuery(truncated) as never }));
    expect((await err).err.message).toMatch(/截断产出/);
    expect(repo.reflectionEntries()).toHaveLength(10);
  });

  it("基础上下文:去重后的基础片段注入 prompt(同一 chunk 只出现一次)", async () => {
    seedReflections(3); // 3 条反思,同一向量都最近邻到同一基础 chunk
    repo.insertKbEntry("faq/x.md", "基础片段X", "faq/x.md", vec());
    let captured = "";
    const qf = (args: { prompt: string }) => {
      captured = args.prompt;
      // 3 条输入 floor=ceil(3*0.7)=3,原样 3 条
      return fakeQuery(faqsJson(3, "甲"))();
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
    // 首轮:5 → 4
    seedReflections(5);
    await runCompact(opts({ queryFn: fakeQuery(faqsJson(4, "甲")) as never }));
    expect(repo.reflectionEntries()).toHaveLength(4);
    // 次轮:4 条(≥ minEntries 3)→ 可再跑;此处 minEntries 抬到 5 跳过
    const qf = vi.fn(fakeQuery(faqsJson(3, "乙")));
    await runCompact(opts({ queryFn: qf as never, minEntries: 5 }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.reflectionEntries()).toHaveLength(4);
  });
});

describe("validateCompacted", () => {
  it("正常 → 返回 trim 后非空 faq 列表", () => {
    expect(validateCompacted('[{"faq":" a "},{"faq":"b"},{"faq":"c"}]', 3)).toEqual(["a", "b", "c"]);
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
    // 3 输入 floor=ceil(2.1)=3;过滤后仅 1 条 → 低于完整下限
    expect(validateCompacted('[{"faq":"a"},{"faq":"  "},{"faq":""}]', 1)).toEqual(["a"]);
  });
  it("完整数组含嵌套 source → 正常解析,忽略额外字段", () => {
    const raw =
      '[{"faq":"甲","source":["1"]},{"faq":"乙","source":["2","7"]},{"faq":"丙","source":["3"]},{"faq":"丁"}]';
    expect(validateCompacted(raw, 5)).toEqual(["甲", "乙", "丙", "丁"]);
  });
  it("截断+嵌套 source:salvage 完整对象且够下限", () => {
    // 输入 5, 截断 floor=ceil(1)=1 → 2 条够
    const raw =
      '[{"faq":"支付方式","source":["1"]},{"faq":"auth","source":["2","7"]},{"faq":"半截';
    expect(validateCompacted(raw, 5)).toEqual(["支付方式", "auth"]);
  });
  it("截断 salvage 过少 → null + 截断 reason", () => {
    const raw = '[{"faq":"仅一条","source":["1"]},{"faq":"半截';
    const r = validateCompactedDetailed(raw, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/截断产出/);
  });
  it(`完整闭合数组低于 COMPLETE_MIN_RATIO(${COMPLETE_MIN_RATIO}) → null`, () => {
    // 10 → 1 闭合完整但过度删除
    const r = validateCompactedDetailed('[{"faq":"合并后唯一条"}]', 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/过度删除/);
    expect(validateCompacted('[{"faq":"合并后唯一条"}]', 10)).toBeNull();
  });
  it("完整闭合数组 ≥ COMPLETE_MIN_RATIO → 通过", () => {
    // 10 → 7 = 70%
    const arr = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ faq: `x${i}` })));
    expect(validateCompacted(arr, 10)).toHaveLength(7);
  });
  it("markdown 代码块包裹 → 仍可抽出数组", () => {
    expect(validateCompacted('```json\n[{"faq":"a"},{"faq":"b"},{"faq":"c"}]\n```', 3)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("schema 根对象 {items:[...]} 文本 → 正常", () => {
    expect(
      validateCompacted('{"items":[{"faq":"甲"},{"faq":"乙"},{"faq":"丙"},{"faq":"丁"}]}', 5)
    ).toEqual(["甲", "乙", "丙", "丁"]);
  });
  it("structured_output {items} 优先于文本", () => {
    expect(
      validateCompacted("抱歉", 5, {
        items: [
          { faq: "  结构A  " },
          { faq: "结构B" },
          { faq: "结构C" },
          { faq: "结构D" },
        ],
      })
    ).toEqual(["结构A", "结构B", "结构C", "结构D"]);
  });
  it("structured_output 非法形状 → null", () => {
    expect(validateCompacted('[{"faq":"文本兜底"}]', 5, { nope: true })).toBeNull();
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
      const qf = vi.fn(fakeQuery(faqsJson(4, "甲")));
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
      const qf = vi.fn(fakeQuery(faqsJson(4, "甲")));
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
