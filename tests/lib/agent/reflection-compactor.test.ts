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
    await runCompact(opts({ queryFn: fakeQuery("抱歉无法处理") as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(5);
  });

  it("安全底线:条目暴涨(> 输入 ×1.5)→ 保留旧库", async () => {
    seedReflections(4);
    const arr = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ faq: `x${i}` })));
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    await runCompact(opts({ queryFn: fakeQuery(arr) as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(4);
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
