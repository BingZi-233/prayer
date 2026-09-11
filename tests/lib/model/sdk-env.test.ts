import { describe, it, expect } from "vitest"
import { sdkEnv } from "@/lib/model/sdk-env"

describe("sdkEnv", () => {
  it("剥掉所有 ANTHROPIC_* 让 settings.json 的 env 接管", () => {
    const out = sdkEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      CLAUDE_CONFIG_DIR: "/abs/data/claude-config",
      ANTHROPIC_BASE_URL: "https://www.packyapi.ai",
      ANTHROPIC_AUTH_TOKEN: "leak",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "x",
    })
    expect(out.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(out.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    // 保留 CONFIG_DIR 与必需变量
    expect(out.CLAUDE_CONFIG_DIR).toBe("/abs/data/claude-config")
    expect(out.PATH).toBe("/usr/bin")
    expect(out.HOME).toBe("/home/x")
  })
  it("丢弃 undefined 值", () => {
    const out = sdkEnv({ A: "1", B: undefined })
    expect(out).toEqual({ A: "1" })
  })
})
