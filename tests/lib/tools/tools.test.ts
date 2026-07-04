import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { makeKbTool } from "@/lib/tools/kb";

let repo: Repo;

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:", 3));
});

describe("kb tool", () => {
  it("检索命中片段文本", async () => {
    const fakeEmbed = async () => new Float32Array([1, 0, 0]);
    const id = repo.insertKbChunk("faq.md", "退货 7 天内", "faq");
    repo.insertKbVec(id, new Float32Array([1, 0, 0]));
    const tool = makeKbTool(repo, fakeEmbed as any, 512);
    const res = await tool.handler({ query: "退货" }, {});
    expect((res.content[0] as { text: string }).text).toContain("退货 7 天内");
  });
});
