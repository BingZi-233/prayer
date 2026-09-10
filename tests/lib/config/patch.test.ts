import { describe, expect, it } from "vitest"
import { appConfigSchema } from "@/lib/core/config/schema"
import { configPatchSchema, mergeConfigPatch } from "@/lib/core/config/patch"

function currentConfig() {
  return appConfigSchema.parse({
    onebotAccessToken: "onebot-secret",
    telegramBotToken: "telegram-secret",
    supportUrl: "https://example.com/support",
    groupPolicies: {
      "qq:100": { proactiveEnabled: true, proactiveSilenceMs: 60_000 },
      "tg:-100": { notifyAdminOnHandoff: false },
    },
  })
}

describe("配置局部更新", () => {
  it("未提交字段不补默认值，空更新不重置配置", () => {
    expect(configPatchSchema.parse({})).toEqual({})
    const patch = configPatchSchema.parse({ ackEnabled: false })
    expect(patch).toEqual({ ackEnabled: false })
    const current = currentConfig()
    expect({ ...current, ...mergeConfigPatch(current, patch) }).toEqual({
      ...current,
      ackEnabled: false,
    })
  })

  it("完整 GET 结果可回传，所有配置字段均有对应写入校验", () => {
    const config = currentConfig()
    expect(configPatchSchema.parse(config)).toEqual(config)
  })

  it("主题统计参数可保存，不再被静默丢弃", () => {
    const patch = {
      topicScanMs: 5000,
      topicSettleMs: 0,
      topicWindowMax: 20,
      topicPromptMax: 30,
    }
    expect(configPatchSchema.parse(patch)).toEqual(patch)
  })

  it.each(["", "••••cret", "••••"])("密钥输入 %j 保留已有值", (value) => {
    const current = currentConfig()
    const patch = mergeConfigPatch(current, {
      onebotAccessToken: value,
      telegramBotToken: value,
    })
    expect(patch.onebotAccessToken).toBe(current.onebotAccessToken)
    expect(patch.telegramBotToken).toBe(current.telegramBotToken)
  })

  it("新密钥替换旧值；省略密钥不产生补丁", () => {
    expect(
      mergeConfigPatch(currentConfig(), { telegramBotToken: "new-token" })
    ).toEqual({ telegramBotToken: "new-token" })
    expect(mergeConfigPatch(currentConfig(), {})).not.toHaveProperty(
      "onebotAccessToken"
    )
  })

  it.each([null, {}])("群策略 %j 删除覆盖，保留其他群", (policy) => {
    const current = currentConfig()
    const next = mergeConfigPatch(current, {
      groupPolicies: { "qq:100": policy },
    })
    expect(next.groupPolicies).toEqual({
      "tg:-100": { notifyAdminOnHandoff: false },
    })
    expect(current.groupPolicies["qq:100"]).toEqual({
      proactiveEnabled: true,
      proactiveSilenceMs: 60_000,
    })
  })

  it("单群策略整份替换，去掉旧字段但不修改输入", () => {
    const current = currentConfig()
    const next = mergeConfigPatch(current, {
      groupPolicies: {
        "qq:100": { proactiveEnabled: false, proactiveSilenceMs: undefined },
      },
    })
    expect(next.groupPolicies?.["qq:100"]).toEqual({ proactiveEnabled: false })
    expect(next.groupPolicies?.["tg:-100"]).toEqual(
      current.groupPolicies["tg:-100"]
    )
    expect(current.groupPolicies["qq:100"].proactiveSilenceMs).toBe(60_000)
  })

  it.each([
    null,
    [],
    "config",
    { ackEnabled: "false" },
    { topicScanMs: "5000" },
    { botQQ: 1.5 },
    { usageBudgetUsd: Infinity },
  ])("拒绝错误类型或非有限数：%j", (input) => {
    expect(configPatchSchema.safeParse(input).success).toBe(false)
  })

  it("删除未知字段，管理面去空白且拒绝空 chatId", () => {
    expect(
      configPatchSchema.parse({
        unknownKey: true,
        adminSurface: { channel: "tg", chatId: " -100 " },
      })
    ).toEqual({ adminSurface: { channel: "tg", chatId: "-100" } })
    expect(
      configPatchSchema.safeParse({
        adminSurface: { channel: "tg", chatId: " " },
      }).success
    ).toBe(false)
  })
})

describe("配置边界与关闭语义", () => {
  it("0 保留不拆分、关闭整理/升格、关闭会话过期的语义", () => {
    const patch = {
      maxReplyChars: 0,
      reflectCompactMs: 0,
      reflectPromoteMs: 0,
      resumeTtlMs: 0,
    }
    expect(configPatchSchema.parse(patch)).toEqual(patch)
  })

  it("保持历史负周期关闭约定，正周期最小一秒", () => {
    expect(
      configPatchSchema.parse({ reflectCompactMs: -1, reflectPromoteMs: -1 })
    ).toEqual({ reflectCompactMs: 0, reflectPromoteMs: 0 })
    expect(
      configPatchSchema.parse({ reflectCompactMs: 1, reflectPromoteMs: 1 })
    ).toEqual({ reflectCompactMs: 1000, reflectPromoteMs: 1000 })
  })

  it("始终运行的扫描周期不能关闭，超出 Node 上限也不会回退到 1ms", () => {
    expect(
      configPatchSchema.parse({
        reflectScanMs: 0,
        proactiveScanMs: -1,
        topicScanMs: 2 ** 31,
      })
    ).toEqual({
      reflectScanMs: 1000,
      proactiveScanMs: 1000,
      topicScanMs: 2 ** 31 - 1,
    })
  })

  it("旧库的过小计数和小数字数上限被规范化", () => {
    expect(
      configPatchSchema.parse({
        maxReplyChars: 1,
        topicWindowMax: 0,
        kbPrefetchTopK: 1.8,
      })
    ).toEqual({ maxReplyChars: 50, topicWindowMax: 1, kbPrefetchTopK: 2 })
  })
})
