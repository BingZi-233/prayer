import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const execFileMock = vi.fn()
vi.mock("node:child_process", () => ({
  execFile: (...a: unknown[]) => execFileMock(...a),
}))

import {
  pluginCliEnv,
  PluginManager,
  isValidPluginRef,
} from "@/lib/model/plugins/manager"

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

describe("pluginCliEnv", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("不把应用、模型和数据库凭据传给第三方 CLI", () => {
    vi.stubEnv("ADMIN_TOKEN", "admin-secret")
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "model-secret")
    vi.stubEnv("ONEBOT_ACCESS_TOKEN", "onebot-secret")
    vi.stubEnv("DB_PATH", "/tmp/agent.db")
    vi.stubEnv("AWS_ACCESS_KEY_ID", "aws-secret")
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/gcp.json")
    vi.stubEnv("HTTPS_PROXY", "https://user:pass@example.test")
    vi.stubEnv("PATH", "/usr/bin")

    const env = pluginCliEnv("/tmp/cfgdir-test")
    expect(env.CLAUDE_CONFIG_DIR).toContain("cfgdir-test")
    expect(env.ADMIN_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ONEBOT_ACCESS_TOKEN).toBeUndefined()
    expect(env.DB_PATH).toBeUndefined()
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.PATH).toBe("/usr/bin")
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

  it("解析 marketplace list --json", async () => {
    execFileMock.mockClear()
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
      cb(
        null,
        '[{"name":"prayer-local","source":"directory","path":"/tmp/prayer"}]',
        ""
      )
    )
    await expect(mgr().listMarketplaces()).resolves.toEqual([
      { name: "prayer-local", source: "directory", path: "/tmp/prayer" },
    ])
    expect(execFileMock.mock.calls[0][1]).toEqual([
      "plugin",
      "marketplace",
      "list",
      "--json",
    ])
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

  it("removeMarketplace 使用显式 marketplace remove", async () => {
    okExec()
    await expect(mgr().removeMarketplace("prayer-local")).resolves.toEqual({
      ok: true,
      stdout: "done",
    })
    expect(execFileMock.mock.calls[0][1]).toEqual([
      "plugin",
      "marketplace",
      "remove",
      "prayer-local",
    ])
  })

  it("restoreEnabled 只恢复同版本同 scope 的实际状态变化", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) =>
        cb(
          null,
          '[{"id":"pkg@mkt","version":"1.0.0","scope":"user","enabled":true,"installPath":"/tmp/pkg"}]',
          ""
        )
      )
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, "done", ""))
    const result = await mgr().restoreEnabled({
      id: "pkg@mkt",
      version: "1.0.0",
      scope: "user",
      enabled: false,
      installPath: "/tmp/pkg",
    })
    expect(result.ok).toBe(true)
    expect(execFileMock.mock.calls[1][1]).toEqual([
      "plugin",
      "disable",
      "pkg@mkt",
      "--scope",
      "user",
    ])
  })

  it("restoreEnabled 版本变化时拒绝反向操作", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
      cb(
        null,
        '[{"id":"pkg@mkt","version":"2.0.0","scope":"user","enabled":true,"installPath":"/tmp/pkg"}]',
        ""
      )
    )
    const result = await mgr().restoreEnabled({
      id: "pkg@mkt",
      version: "1.0.0",
      scope: "user",
      enabled: false,
      installPath: "/tmp/pkg",
    })
    expect(result).toEqual({
      ok: false,
      error: "插件版本或 scope 已变化，拒绝自动恢复启停状态",
    })
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })
})
