import { describe, it, expect, vi } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...a: unknown[]) => execFileMock(...a) }));

import { PluginManager, isValidPluginRef } from "@/lib/plugins/manager";

function mgr() {
  return new PluginManager("/tmp/cfgdir-test");
}

describe("isValidPluginRef", () => {
  it("放行正常 name@marketplace", () => {
    expect(isValidPluginRef("packyapi@prayer-local")).toBe(true);
    expect(isValidPluginRef("rust-analyzer-lsp@claude-plugins-official")).toBe(true);
  });
  it("拒绝注入字符", () => {
    for (const bad of ["a; rm -rf /", "a$(whoami)", "a`id`", "a b", "a|b", "a&b", "a\nb", "a>b"]) {
      expect(isValidPluginRef(bad)).toBe(false);
    }
  });
});

describe("PluginManager.list", () => {
  it("解析 --json 并注入 CLAUDE_CONFIG_DIR", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
      cb(null, '[{"id":"packyapi@prayer-local","version":"0.1.0","scope":"user","enabled":true,"installPath":"x"}]', "")
    );
    const res = await mgr().list();
    expect(res).toEqual([
      { id: "packyapi@prayer-local", version: "0.1.0", scope: "user", enabled: true, installPath: "x" },
    ]);
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toEqual(["plugin", "list", "--json"]);
    expect((opts as { env: Record<string, string> }).env.CLAUDE_CONFIG_DIR).toContain("cfgdir-test");
  });
});
