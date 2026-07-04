import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { bus } from "../bus";
import { makeKbTool } from "./kb";
import { makeHandoffTool } from "./handoff";

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

describe("handoff tool", () => {
  it("调用只 emit handoff.requested,不直接改库", async () => {
    const p = new Promise<any>((res) => bus.once("handoff.requested", res));
    const tool = makeHandoffTool({ sessionKey: "1:2", groupId: 1, userId: 2 });
    const res = await tool.handler({ lastQuestion: "退款没到" }, {});
    const evt = await p;
    expect(evt.sessionKey).toBe("1:2");
    expect(evt.groupId).toBe(1);
    expect(evt.userId).toBe(2);
    expect(evt.lastQuestion).toBe("退款没到");
    expect((res.content[0] as { text: string }).text).toContain("人工");
    expect(repo.isHumanMode("1:2")).toBe(false);
  });
});
