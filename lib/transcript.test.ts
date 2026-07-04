import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscript, findTranscript } from "./transcript";

describe("parseTranscript", () => {
  it("解析 user/assistant 文本 + tool_use", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { content: "你好" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "您好,请问" }, { type: "tool_use", name: "kb_search", input: { q: "退款" } }] },
      }),
    ].join("\n");
    const msgs = parseTranscript(jsonl);
    expect(msgs[0]).toEqual({ role: "user", text: "你好", tool: undefined });
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].text).toBe("您好,请问");
    expect(msgs[1].tool).toBe("kb_search");
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
