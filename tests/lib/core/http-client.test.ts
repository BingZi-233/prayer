import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchApi, readApiResponse } from "@/lib/core/http-client"

afterEach(() => vi.unstubAllGlobals())

describe("管理客户端响应", () => {
  it.each([true, false, "true"])(
    "只保留显式布尔 outcomeUnknown=true: %s",
    async (flag) => {
      const result = await readApiResponse(
        Response.json({
          ok: false,
          error: "任务结果无法确认",
          outcomeUnknown: flag,
        })
      )
      expect(result.ok).toBe(false)
      expect("outcomeUnknown" in result).toBe(flag === true)
    }
  )

  it("保留正常 API 数据与已脱敏的业务错误", async () => {
    expect(
      await readApiResponse(Response.json({ ok: true, data: { count: 2 } }))
    ).toEqual({ ok: true, data: { count: 2 } })
    expect(
      await readApiResponse(
        Response.json({ ok: false, error: "该条目已被驳回" }, { status: 409 })
      )
    ).toEqual({ ok: false, error: "该条目已被驳回" })
  })

  it.each([502, 504, 524])(
    "网关 HTML %i 返回 HTTP 诊断,不回显网页或解析异常",
    async (status) => {
      const result = await readApiResponse(
        new Response(
          "<!DOCTYPE html><html>private password=secret-value</html>",
          {
            status,
            headers: { "content-type": "text/html" },
          }
        ),
        { mutation: true }
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain(`HTTP ${status}`)
        expect(result.error).toContain("操作结果尚未确认")
        expect(result.error).not.toMatch(
          /DOCTYPE|private|password|secret|Unexpected token/
        )
      }
    }
  )

  it("HTTP 200 的网页也不是成功结果", async () => {
    const result = await readApiResponse(
      new Response("<!DOCTYPE html><html>登录</html>"),
      { mutation: true }
    )
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("操作结果尚未确认"),
    })
  })

  it("401 与跟随登录重定向清楚说明登录失效", async () => {
    const response = new Response("<html>login</html>")
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: "https://example.test/login?token=private" },
    })
    for (const candidate of [
      response,
      new Response("unauthorized", { status: 401 }),
    ]) {
      const result = await readApiResponse(candidate, { mutation: true })
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining("重新登录"),
      })
      if (!result.ok) expect(result.error).not.toContain("private")
    }
  })

  it.each([
    "not json",
    "null",
    "[]",
    '{"ok":true}',
    '{"ok":false,"error":"<html>private</html>"}',
    '{"ok":false,"error":"<!DOCTYPE html private"}',
  ])("拒绝无效 JSON/envelope: %s", async (body) => {
    const result = await readApiResponse(new Response(body), { mutation: true })
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("操作结果尚未确认"),
    })
    if (!result.ok) expect(result.error).not.toContain("private")
  })

  it("JSON 错误再次脱敏并限长", async () => {
    const result = await readApiResponse(
      Response.json(
        {
          ok: false,
          error: `api_key=secret-client-value ${"错误".repeat(400)}`,
        },
        { status: 500 }
      )
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).not.toContain("secret-client-value")
      expect(result.error.length).toBeLessThanOrEqual(300)
    }
  })

  it("JSON 错误 envelope 包含原始解析异常或截断网页时不直接展示", async () => {
    for (const error of [
      `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
      `Unexpected token '<', "<"... is not valid JSON`,
    ]) {
      const result = await readApiResponse(
        Response.json({ ok: false, error }),
        { mutation: true }
      )
      expect(result).toMatchObject({ ok: false, outcomeUnknown: true })
      if (!result.ok)
        expect(result.error).not.toMatch(
          /Unexpected token|DOCTYPE|not valid JSON/
        )
    }
  })

  it("HTTP 错误不能被 ok:true 的响应体冒充成功", async () => {
    expect(
      await readApiResponse(
        Response.json({ ok: true, data: {} }, { status: 502 }),
        { mutation: true }
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining("HTTP 502") })
  })

  it("POST 网络中断只发送一次,提示结果未知且不泄露异常内容", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(
        new Error("https://example.test/?api_key=secret-client-value")
      )
    vi.stubGlobal("fetch", fetcher)
    const result = await fetchApi("/api/reflection/promote", { method: "POST" })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("操作结果尚未确认"),
    })
    if (!result.ok) expect(result.error).not.toContain("secret-client-value")
  })

  it("客户端超时不伪造 HTTP 响应状态,也不重发写操作", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(
        new DOMException("private deadline context", "TimeoutError")
      )
    vi.stubGlobal("fetch", fetcher)
    const result = await fetchApi("/api/reflection/compact", { method: "POST" })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(result).toMatchObject({
      ok: false,
      outcomeUnknown: true,
      error: expect.stringContaining("等待服务响应超时"),
    })
    if (!result.ok) expect(result.error).not.toMatch(/HTTP|private/)
  })

  it("尊重调用方 signal,收到响应头后读取正文也可超时取消", async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{"ok":true,"data":'))
              init.signal!.addEventListener("abort", () =>
                stream.error(init.signal!.reason)
              )
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
    vi.stubGlobal("fetch", fetcher)
    const pending = fetchApi("/api/reflection/compact", {
      method: "POST",
      signal: controller.signal,
    })
    await Promise.resolve()
    controller.abort(new DOMException("private timeout", "TimeoutError"))
    const result = await pending
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal)
    expect(result).toMatchObject({
      ok: false,
      outcomeUnknown: true,
      error: expect.stringContaining("等待服务响应超时"),
    })
    if (!result.ok) expect(result.error).not.toContain("private")
  })
})
