import { describe, expect, it, vi } from "vitest"
import { getConfig, setConfig } from "@/lib/config-store"
import type { Repo } from "@/lib/db/repo"

/** 配置仅依赖两项存储操作；测试恢复行为无需加载原生数据库。 */
function configRepo(initial?: string) {
  let row = initial
  const getConfigRow = vi.fn(() => row)
  const setConfigRow = vi.fn((_key: string, value: string) => {
    row = value
  })
  return { getConfigRow, setConfigRow } as Pick<
    Repo,
    "getConfigRow" | "setConfigRow"
  >
}

describe("配置读取恢复", () => {
  it.each(["null", "[]", "42", '"text"', "false", "{"])(
    "非配置 JSON %s 回退种子且可再次读取",
    (raw) => {
      const repo = configRepo(raw)
      const config = getConfig(repo, { BOT_QQ: "123" })
      expect(config.botQQ).toBe(123)
      expect(getConfig(repo, {})).toEqual(config)
    }
  )

  it("无效环境数值按字段回退，不丢失有效配置", () => {
    const config = getConfig(configRepo(), {
      REFLECT_SCAN_MS: "abc",
      TOPIC_SCAN_MS: "Infinity",
      BOT_QQ: "789",
      TELEGRAM_BOT_TOKEN: "test-token",
    })
    expect(config.reflectScanMs).toBe(300_000)
    expect(config.topicScanMs).toBe(300_000)
    expect(config.botQQ).toBe(789)
    expect(config.telegramBotToken).toBe("test-token")
  })

  it("坏字段不会让整个旧库配置失效，未知字段不进入运行时", () => {
    const repo = configRepo(
      JSON.stringify({
        botQQ: 123,
        groupPolicies: null,
        ackEnabled: "false",
        onebotAccessToken: "saved-token",
        staleKey: "old",
      })
    )
    const config = getConfig(repo, {})
    expect(config.botQQ).toBe(123)
    expect(config.onebotAccessToken).toBe("saved-token")
    expect(config.groupPolicies).toEqual({})
    expect(config.ackEnabled).toBe(true)
    expect(config).not.toHaveProperty("staleKey")
  })

  it("旧库没有白名单字段时继承环境种子，显式空列表不被覆盖", () => {
    const env = { TELEGRAM_ENABLED_CHATS: "-100" }
    expect(getConfig(configRepo("{}"), env).enabledChats).toEqual([
      { channel: "tg", chatId: "-100" },
    ])
    expect(
      getConfig(configRepo('{"enabledChats":[]}'), env).enabledChats
    ).toEqual([])
    expect(
      getConfig(configRepo('{"enabledGroups":[]}'), env).enabledChats
    ).toEqual([])
  })

  it("内部写入同样校验周期并忽略 undefined 补丁", () => {
    const repo = configRepo()
    getConfig(repo, { SUPPORT_URL: "https://example.com" })
    const next = setConfig(repo, { supportUrl: undefined, topicScanMs: 0 })
    expect(next.supportUrl).toBe("https://example.com")
    expect(next.topicScanMs).toBe(1000)
  })

  it("内部非法写入失败时保留原数据", () => {
    const repo = configRepo()
    const current = getConfig(repo, {})
    expect(() => setConfig(repo, { usageBudgetUsd: NaN })).toThrow()
    expect(getConfig(repo, {})).toEqual(current)
  })
})
