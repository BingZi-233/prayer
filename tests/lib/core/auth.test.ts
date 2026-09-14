import { describe, expect, it, beforeEach } from "vitest"
import {
  clearLoginFails,
  clientIp,
  loginThrottleState,
  LOGIN_BLOCK_MS,
  LOGIN_MAX_FAILS,
  recordLoginFail,
  timingSafeEqualStr,
} from "@/lib/core/auth"

beforeEach(() => {
  // globalThis 状态必须显式清,防用例间串扰
  clearLoginFails("1.2.3.4")
  clearLoginFails("5.6.7.8")
})

describe("timingSafeEqualStr", () => {
  it("相同串 true;长度不同/内容不同 false", () => {
    expect(timingSafeEqualStr("secret", "secret")).toBe(true)
    expect(timingSafeEqualStr("secret", "secreT")).toBe(false)
    expect(timingSafeEqualStr("secret", "secret2")).toBe(false)
    expect(timingSafeEqualStr("", "secret")).toBe(false)
    expect(timingSafeEqualStr("", "")).toBe(true)
  })
})

describe("登录爆破限速", () => {
  it("连续 5 次失败后锁定,期间拒绝并给出剩余时间", () => {
    const t0 = 1_000_000
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginFail("1.2.3.4", t0)
    const s = loginThrottleState("1.2.3.4", t0)
    expect(s.blocked).toBe(true)
    expect(s.retryAfterMs).toBe(LOGIN_BLOCK_MS)
    // 15 分钟内仍锁
    const mid = loginThrottleState("1.2.3.4", t0 + LOGIN_BLOCK_MS - 1)
    expect(mid.blocked).toBe(true)
    expect(mid.retryAfterMs).toBe(1)
    // 过期解锁
    expect(loginThrottleState("1.2.3.4", t0 + LOGIN_BLOCK_MS).blocked).toBe(
      false
    )
  })

  it("成功登录清零计数,失败不累积到锁定", () => {
    const t0 = 1_000_000
    recordLoginFail("5.6.7.8", t0)
    recordLoginFail("5.6.7.8", t0)
    clearLoginFails("5.6.7.8")
    recordLoginFail("5.6.7.8", t0)
    expect(loginThrottleState("5.6.7.8", t0).blocked).toBe(false)
    // IP 之间互不影响
    recordLoginFail("1.2.3.4", t0)
    expect(loginThrottleState("5.6.7.8", t0).blocked).toBe(false)
  })
})

describe("clientIp", () => {
  it("默认不信任可伪造的代理头", () => {
    const h = new Headers()
    expect(clientIp(h)).toBe("unknown")
    h.set("x-real-ip", "9.9.9.9")
    expect(clientIp(h)).toBe("unknown")
    h.set("x-forwarded-for", "1.2.3.4, 10.0.0.1")
    expect(clientIp(h)).toBe("unknown")
  })

  it("显式信任代理时读取首个合法转发地址", () => {
    const h = new Headers()
    h.set("x-real-ip", "9.9.9.9")
    expect(clientIp(h, true)).toBe("9.9.9.9")
    h.set("x-forwarded-for", "1.2.3.4, 10.0.0.1")
    expect(clientIp(h, true)).toBe("1.2.3.4")
    h.set("x-forwarded-for", "not-an-ip, 2001:db8::1")
    expect(clientIp(h, true)).toBe("2001:db8::1")
  })

  it("拒绝注入型代理头", () => {
    const h = new Headers()
    h.set("x-forwarded-for", "1.2.3.4:bad, attacker\\n")
    expect(clientIp(h, true)).toBe("unknown")
  })

  it("直连时使用 adapter 提供的服务端 request 地址,不读取伪造 header", () => {
    const h = new Headers({ "x-forwarded-for": "9.9.9.9" })
    expect(clientIp({ headers: h, ip: "192.0.2.10" }, false)).toBe("192.0.2.10")
    expect(
      clientIp({ headers: h, socket: { remoteAddress: "192.0.2.11" } }, false)
    ).toBe("192.0.2.11")
    expect(clientIp({ headers: h, ip: "not-an-ip" }, false)).toBe("unknown")
  })
})
