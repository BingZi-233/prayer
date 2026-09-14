import { describe, it, expect } from "vitest"
import {
  errorMessage,
  redactSensitive,
  groupIdFromSession,
  chatRefFromSession,
} from "@/lib/core/log-context"

describe("errorMessage / chatRefFromSession", () => {
  it("errorMessage", () => {
    expect(errorMessage(new Error("x"))).toBe("x")
    expect(errorMessage("y")).toBe("y")
    expect(errorMessage({ a: 1 })).toBe('{"a":1}')
    expect(errorMessage(undefined)).toBe("undefined")
  })

  it("chatRefFromSession 规范键与历史两段键", () => {
    expect(chatRefFromSession("qq:42:9")).toEqual({
      channel: "qq",
      chatId: "42",
    })
    expect(chatRefFromSession("tg:-1001:7")).toEqual({
      channel: "tg",
      chatId: "-1001",
    })
    expect(chatRefFromSession("42:9")).toEqual({
      channel: "qq",
      chatId: "42",
    })
    expect(chatRefFromSession(undefined)).toBeUndefined()
    expect(chatRefFromSession("abc")).toBeUndefined()
  })

  it("groupIdFromSession 仍兼容 QQ 数字", () => {
    expect(groupIdFromSession("42:9")).toBe(42)
    expect(groupIdFromSession("tg:-1001:7")).toBeUndefined()
    expect(groupIdFromSession(undefined)).toBeUndefined()
  })

  it("redactSensitive 隐藏密钥、认证头和签名 URL 参数", () => {
    const text =
      "sk-ant-abcdefghijklmnopqrstuvwxyz Bearer secret-token https://x.test/a?token=abc&ok=1"
    const out = redactSensitive(text)
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz")
    expect(out).not.toContain("secret-token")
    expect(out).not.toContain("token=abc")
    expect(out).toContain("ok=1")
  })

  it("也隐藏带 Authorization 前缀的 JSON/key-value 口令", () => {
    const out = redactSensitive(
      'Authorization: Bearer supersecret token="json-secret" 123456:abcdefghijklmnopqrstuvwxyz'
    )
    expect(out).not.toContain("supersecret")
    expect(out).not.toContain("json-secret")
    expect(out).not.toContain("123456:abcdefghijklmnopqrstuvwxyz")
  })

  it("隐藏常见环境变量风格的认证键", () => {
    const out = redactSensitive(
      "ANTHROPIC_AUTH_TOKEN=anthropic-secret BOT_TOKEN=bot-secret PRIVATE_KEY=pkey"
    )
    expect(out).not.toContain("anthropic-secret")
    expect(out).not.toContain("bot-secret")
    expect(out).not.toContain("pkey")
  })
})
