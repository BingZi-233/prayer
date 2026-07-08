import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";

let repo: Repo;
const vec = () => new Float32Array([1, 0, 0]);

beforeEach(() => {
  repo = new Repo(openDb(":memory:", 3));
});

describe("reflection_meta / reflectionEntries", () => {
  it("insertReflectionMeta → reflectionEntries 带出 question/answer", () => {
    const id = repo.insertKbEntry("human-reflection", "faq甲", "human-reflection:100:5", vec());
    repo.insertReflectionMeta(id, 100, "问X", "答Y");
    const e = repo.reflectionEntries().find((r) => r.id === id)!;
    expect(e).toMatchObject({ groupId: 100, ts: 5, question: "问X", answer: "答Y" });
  });

  it("无 meta 的条目 → question/answer 为 null", () => {
    const id = repo.insertKbEntry("human-reflection", "无源", "human-reflection:100:5", vec());
    expect(repo.reflectionEntries().find((r) => r.id === id)).toMatchObject({ question: null, answer: null });
  });

  it("replaceReflectionEntries → 删旧 meta(不留孤儿)+ 记 compaction", () => {
    const id = repo.insertKbEntry("human-reflection", "旧条目", "human-reflection:100:1", vec());
    repo.insertReflectionMeta(id, 100, "q", "a");
    repo.replaceReflectionEntries(
      [id],
      [{ content: "新条目", embedding: vec() }],
      9_000_000,
      ["旧条目"],
      ["新条目"]
    );
    const entries = repo.reflectionEntries();
    expect(entries).toHaveLength(1);
    // 新条目 gid=0、无 meta;旧 meta 已随 chunk 删除
    expect(entries[0]).toMatchObject({ content: "新条目", groupId: 0, question: null, answer: null });
    const rc = repo.recentCompactions(5);
    expect(rc).toHaveLength(1);
    expect(rc[0]).toMatchObject({ ts: 9_000_000, beforeCount: 1, afterCount: 1, before: ["旧条目"], after: ["新条目"] });
  });

  it("recentCompactions 按 ts 倒序、limit 生效", () => {
    for (const ts of [100, 300, 200]) {
      repo.replaceReflectionEntries([], [], ts, [`b${ts}`], [`a${ts}`]);
    }
    const rc = repo.recentCompactions(2);
    expect(rc.map((r) => r.ts)).toEqual([300, 200]);
  });
});
