import { describe, it, expect } from "vitest";
import { buildToolPolicy } from "@/lib/agent/introspect";

describe("buildToolPolicy", () => {
  it("allowlist 含 kb_search / WebSearch / Skill,gated 含 Bash/Read/WebFetch", () => {
    const p = buildToolPolicy();
    expect(p.allowlist).toContain("mcp__cs__kb_search");
    expect(p.allowlist).toContain("WebSearch");
    expect(p.allowlist).toContain("Skill");
    const tools = p.gated.map((g) => g.tool);
    expect(tools).toEqual(["Bash", "Read", "WebFetch"]);
    for (const g of p.gated) expect(g.constraint.length).toBeGreaterThan(0);
  });
});
