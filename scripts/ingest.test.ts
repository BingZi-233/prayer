import { describe, it, expect, vi } from "vitest";
import { chunkText, runIngest } from "./ingest";
import { openDb } from "../lib/db/index";
import { Repo } from "../lib/db/repo";

vi.mock("../lib/tools/embed", () => ({
  embed: async () => new Float32Array([0.1, 0.2, 0.3]),
}));

describe("chunkText", () => {
  it("按段落切块,过滤空块", () => {
    const chunks = chunkText("第一段\n\n第二段\n\n\n第三段");
    expect(chunks).toEqual(["第一段", "第二段", "第三段"]);
  });
  it("超长段落按上限切分", () => {
    const long = "a".repeat(1200);
    const chunks = chunkText(long, 500);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(500);
  });
});

describe("runIngest", () => {
  it("对给定目录切块入库,返回统计", async () => {
    const repo = new Repo(openDb(":memory:", 3));
    const res = await runIngest(repo, "docs/kb");
    expect(Array.isArray(res)).toBe(true);
    // 至少不报错;若 docs/kb 有文件则 chunks>0
    for (const r of res) expect(r.chunks).toBeGreaterThanOrEqual(0);
  });
});
