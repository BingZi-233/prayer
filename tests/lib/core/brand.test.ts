import { describe, expect, it } from "vitest"
import { DEFAULT_BRAND, resolveBrand } from "@/lib/core/brand"
import { appConfigSchema } from "@/lib/core/config/schema"
import { buildDefaultSystem } from "@/lib/model/system-prompt"
import { buildIntentSystem } from "@/lib/agent/intent"
import { buildAnswerabilitySystem } from "@/lib/agent/answerability"

describe("Prayer 品牌配置", () => {
  it("默认配置使用 Prayer，且不绑定 PackyAPI 支持链接", () => {
    const cfg = appConfigSchema.parse({})
    expect(DEFAULT_BRAND.name).toBe("Prayer")
    expect(cfg.brandName).toBe("Prayer")
    expect(cfg.brandDescription).toBe("多渠道 AI 客服中台")
    expect(cfg.supportUrl).toBe("")
  })

  it("空白白标输入回退默认品牌，非空输入保留自定义值", () => {
    expect(resolveBrand({ name: "  ", description: " " })).toEqual(
      DEFAULT_BRAND
    )
    expect(
      resolveBrand({ name: " Acme ", description: " Acme 客服平台 " })
    ).toEqual({ name: "Acme", description: "Acme 客服平台" })
  })

  it("主 Agent 与旁路判定器都使用同一品牌身份", () => {
    const brand = { name: "Acme", description: "Acme 支持平台" }
    expect(buildDefaultSystem({ brand })).toContain("你是 Acme 的官方在线客服")
    expect(buildIntentSystem(brand)).toContain("Acme 客服系统")
    expect(buildAnswerabilitySystem(brand)).toContain("Acme 客服系统")
  })
})
