import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscript, findTranscript } from "@/lib/transcript";

describe("parseTranscript", () => {
  it("文本与 tool_use 拆成独立条目", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { content: "你好" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "您好,请问" }, { type: "tool_use", name: "kb_search", input: { q: "退款" } }] },
      }),
    ].join("\n");
    const msgs = parseTranscript(jsonl);
    expect(msgs[0]).toEqual({ role: "user", text: "你好" });
    expect(msgs[1]).toEqual({ role: "assistant", text: "您好,请问" });
    expect(msgs[2].role).toBe("tool");
    expect(msgs[2].tool).toBe("kb_search");
    expect(msgs[2].input).toContain("退款");
  });

  it("tool_result 按 tool_use_id 回填到对应 tool_use 的 result", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "call_1", name: "kb_search", input: { query: "价格" } }] },
      }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "call_1", content: [{ type: "text", text: "知识库无相关内容。" }] }] },
      }),
    ].join("\n");
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(1); // tool_result 合并进 tool_use,不新增条目
    expect(msgs[0].role).toBe("tool");
    expect(msgs[0].tool).toBe("kb_search");
    expect(msgs[0].input).toContain("价格");
    expect(msgs[0].result).toBe("知识库无相关内容。");
  });

  it("坏行跳过,未知类型忽略", () => {
    const jsonl = ["{bad json", JSON.stringify({ type: "system", subtype: "init" }), JSON.stringify({ type: "user", message: { content: "hi" } })].join("\n");
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("hi");
  });

  it("空输入返回空数组", () => {
    expect(parseTranscript("")).toEqual([]);
  });
});

describe("findTranscript", () => {
  it("在 configDir/projects 下递归找 <id>.jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const proj = join(dir, "projects", "-some-slug");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "abc-123.jsonl"), "");
    expect(findTranscript(dir, "abc-123")).toBe(join(proj, "abc-123.jsonl"));
    expect(findTranscript(dir, "nope")).toBeNull();
  });
});
