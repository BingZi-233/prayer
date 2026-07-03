import { describe, it, expect } from "vitest";
import { chunkText } from "./ingest";

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
