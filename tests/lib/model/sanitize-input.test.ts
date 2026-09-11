import { describe, it, expect } from "vitest"
import {
  sanitizeForModel,
  isNewSensitiveError,
} from "@/lib/model/sanitize-input"

describe("sanitizeForModel", () => {
  it("空串原样返回", () => {
    expect(sanitizeForModel("")).toBe("")
  })

  it("普通客服问句不动", () => {
    const t = "退款要多久到账?claude-sale 分组怎么换"
    expect(sanitizeForModel(t)).toBe(t)
  })

  it("剔除翻墙/科学上网等网络绕行词,保留其余语义", () => {
    expect(sanitizeForModel("更换分组得翻墙是不是")).toBe(
      "更换分组得[网络]是不是"
    )
    expect(sanitizeForModel("需要科学上网才能用")).toBe("需要[网络]才能用")
    expect(sanitizeForModel("翻 墙 后还是 403")).toBe("[网络] 后还是 403")
  })

  it("独立 token 的 fq 缩写剔除,嵌入其它英文词不误伤", () => {
    expect(sanitizeForModel("fq也算敏感词")).toBe("[网络]也算敏感词")
    expect(sanitizeForModel("用 FQ 才能连")).toBe("用 [网络] 才能连")
    expect(sanitizeForModel("prefixfqsuffix")).toBe("prefixfqsuffix")
    expect(sanitizeForModel("config.json")).toBe("config.json")
  })

  it("繁体翻牆/科學上網同样剔除", () => {
    expect(sanitizeForModel("要翻牆才行")).toBe("要[网络]才行")
    expect(sanitizeForModel("科學上網后访问")).toBe("[网络]后访问")
  })

  it("脱敏 API token 形态,避免密钥进模型", () => {
    expect(
      sanitizeForModel("我的 key 是 sk-ant-api03-abcdefghijklmnop 帮我看")
    ).toBe("我的 key 是 [TOKEN] 帮我看")
    expect(sanitizeForModel("token=sk-abcdefghijklmnopqrstuv")).toBe(
      "token=[TOKEN]"
    )
  })
})

describe("isNewSensitiveError", () => {
  it("识别 MiniMax/Foundry new_sensitive 文案", () => {
    expect(
      isNewSensitiveError(
        new Error(
          "Claude Code returned an error result: API Error: 500 input new_sensitive (1026). This is a server-side issue"
        )
      )
    ).toBe(true)
    expect(
      isNewSensitiveError("API Error: 500 input new_sensitive (1026)")
    ).toBe(true)
  })

  it("普通错误不是 sensitive", () => {
    expect(isNewSensitiveError(new Error("agent run 超时(180000ms)"))).toBe(
      false
    )
    expect(isNewSensitiveError("rate limit 429")).toBe(false)
    expect(isNewSensitiveError(null)).toBe(false)
  })
})
