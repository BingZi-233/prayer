import { describe, it, expect, vi, beforeEach } from "vitest"

const execFileMock = vi.fn()
vi.mock("node:child_process", () => ({
  execFile: (...a: unknown[]) => execFileMock(...a),
}))

import { PluginManager, isValidPluginRef } from "@/lib/plugins/manager"

function mgr() {
  return new PluginManager("/tmp/cfgdir-test")
}

describe("isValidPluginRef", () => {
  it("放行正常 name@marketplace", () => {
    expect(isValidPluginRef("packyapi@prayer-local")).toBe(true)
    expect(isValidPluginRef("rust-analyzer-lsp@claude-plugins-official")).toBe(
      true
    )
  })
  it("拒绝注入字符", () => {
    for (const bad of [
      "a; rm -rf /",
      "a$(whoami)",
      "a`id`",
      "a b",
      "a|b",
      "a&b",
      "a\nb",
      "a>b",
    ]) {
      expect(isValidPluginRef(bad)).toBe(false)
    }
  })
})

describe("PluginManager.list", () => {
  it("解析 --json 并注入 CLAUDE_CONFIG_DIR", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
      cb(
        null,
        '[{"id":"packyapi@prayer-local","version":"0.1.0","scope":"user","enabled":true,"installPath":"x"}]',
        ""
      )
    )
    const res = await mgr().list()
    expect(res).toEqual([
      {
        id: "packyapi@prayer-local",
        version: "0.1.0",
        scope: "user",
        enabled: true,
        installPath: "x",
      },
    ])
    const [cmd, args, opts] = execFileMock.mock.calls[0]
    expect(cmd).toBe("claude")
    expect(args).toEqual(["plugin", "list", "--json"])
    expect(
      (opts as { env: Record<string, string> }).env.CLAUDE_CONFIG_DIR
    ).toContain("cfgdir-test")
  })
})

describe("PluginManager 写操作", () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  function okExec() {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(null, "done", ""))
  }

  it("install 拼 <name>@<mkt> --scope user", async () => {
    okExec()
    const r = await mgr().install("packyapi", "prayer-local")
    expect(r).toEqual({ ok: true, stdout: "done" })
    expect(execFileMock.mock.calls[0][1]).toEqual([
      "plugin",
      "install",
      "packyapi@prayer-local",
      "--scope",
      "user",
    ])
  })

  it("enable/disable/update/uninstall 用 id", async () => {
    okExec()
    const m = mgr()
    await m.enable("packyapi@prayer-local")
    await m.disable("packyapi@prayer-local")
    await m.update("packyapi@prayer-local")
    await m.uninstall("packyapi@prayer-local")
    const sub = execFileMock.mock.calls.map((c) => c[1][1])
    expect(sub).toEqual(["enable", "disable", "update", "uninstall"])
  })

  it("addMarketplace github 传 owner/repo", async () => {
    okExec()
    await mgr().addMarketplace("owner/repo")
    expect(execFileMock.mock.calls[0][1]).toEqual([
      "plugin",
      "marketplace",
      "add",
      "owner/repo",
    ])
  })

  it("非法 ref 直接拒绝,不调 CLI", async () => {
    execFileMock.mockClear()
    await expect(mgr().install("a;rm", "mkt")).rejects.toThrow(/非法/)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it("CLI 非零退出 → ok:false + error", async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb) =>
      cb(new Error("x"), "", "boom")
    )
    const r = await mgr().enable("packyapi@prayer-local")
    expect(r).toEqual({ ok: false, error: "boom" })
  })
})
