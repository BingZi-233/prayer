import { afterEach, describe, expect, it, vi } from "vitest"
import { runReflectionAction } from "@/components/admin/reflection/request-action"

const json = (data: unknown, status = 200) =>
  Response.json({ ok: true, data }, { status })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("反思后台任务客户端", () => {
  it("202 只表示已接受:保持等待,轮询完成后返回最终结果,不重发写操作", async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ jobId: "job-1", status: "running" }, 202))
      .mockResolvedValueOnce(json({ id: "job-1", status: "running" }))
      .mockResolvedValueOnce(
        json({
          id: "job-1",
          status: "completed",
          result: { ok: true, data: { promoted: 2 } },
        })
      )
    vi.stubGlobal("fetch", fetcher)
    const onRunning = vi.fn()
    let settled = false
    const pending = runReflectionAction(
      "/api/reflection/promote",
      { method: "POST" },
      onRunning
    ).then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(onRunning).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toEqual({ ok: true, data: { promoted: 2 } })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[0][1].headers.get("Prefer")).toBe("respond-async")
    expect(
      fetcher.mock.calls
        .slice(1)
        .every(
          ([url, init]) =>
            url === "/api/reflection/jobs/job-1" &&
            init.method == null &&
            init.signal instanceof AbortSignal
        )
    ).toBe(true)
  })

  it("后台任务的部分失败按最终结果呈现并脱敏", async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ jobId: "job-2", status: "running" }))
      .mockResolvedValueOnce(
        json({
          id: "job-2",
          status: "completed",
          result: {
            ok: false,
            error: "已升格 2 条; api_key=private-key-value",
          },
        })
      )
    vi.stubGlobal("fetch", fetcher)
    const pending = runReflectionAction("/api/reflection/promote", {
      method: "POST",
    })
    await vi.advanceTimersByTimeAsync(3000)
    const result = await pending
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("已升格 2 条"),
    })
    if (!result.ok) expect(result.error).not.toContain("private-key-value")
  })

  it("后台任务异常的结果未知标记保留到最终 UI 响应", async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ jobId: "job-unknown", status: "running" }, 202)
      )
      .mockResolvedValueOnce(
        json({
          id: "job-unknown",
          status: "completed",
          result: {
            ok: false,
            error: "任务异常，结果无法确认",
            outcomeUnknown: true,
          },
        })
      )
    vi.stubGlobal("fetch", fetcher)
    const pending = runReflectionAction("/api/reflection/promote", {
      method: "POST",
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toMatchObject({ ok: false, outcomeUnknown: true })
  })

  it.each([404, 401, 524])(
    "轮询 HTTP %i 后提示结果未知,不重新提交任务",
    async (status) => {
      vi.useFakeTimers()
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(json({ jobId: "job-3", status: "running" }))
        .mockResolvedValueOnce(
          new Response("<!DOCTYPE html><html>private</html>", { status })
        )
      vi.stubGlobal("fetch", fetcher)
      const pending = runReflectionAction("/api/reflection/promote", {
        method: "POST",
      })
      await vi.advanceTimersByTimeAsync(3000)
      const result = await pending
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining("任务结果尚未确认"),
      })
      expect(fetcher).toHaveBeenCalledTimes(2)
      if (!result.ok) expect(result.error).not.toContain("private")
    }
  )

  it("兼容同步的业务响应,不触发额外任务轮询", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ file: "faq.md" }))
    vi.stubGlobal("fetch", fetcher)
    expect(
      await runReflectionAction("/api/reflection", { method: "PATCH" })
    ).toEqual({ ok: true, data: { file: "faq.md" } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("完成记录中的 HTML 错误不会泄露到 toast", async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ jobId: "job-4", status: "running" }))
      .mockResolvedValueOnce(
        json({
          id: "job-4",
          status: "completed",
          result: { ok: false, error: "<html>private</html>" },
        })
      )
    vi.stubGlobal("fetch", fetcher)
    const pending = runReflectionAction("/api/reflection/promote", {
      method: "POST",
    })
    await vi.advanceTimersByTimeAsync(3000)
    const result = await pending
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("任务结果尚未确认"),
    })
    if (!result.ok) expect(result.error).not.toContain("private")
  })

  it("页面卸载在轮询间隔中取消等待,清除计时器且不再发请求", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ jobId: "job-stop", status: "running" }, 202)
      )
    vi.stubGlobal("fetch", fetcher)
    const pending = runReflectionAction(
      "/api/reflection/promote",
      { method: "POST" },
      undefined,
      controller.signal
    )
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, outcomeUnknown: true })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("页面卸载取消正在读取的任务状态,不重发写请求或继续轮询", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let pollSignal: AbortSignal | undefined
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ jobId: "job-stop-fetch", status: "running" }, 202)
      )
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            pollSignal = init.signal
            pollSignal!.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            )
          })
      )
    vi.stubGlobal("fetch", fetcher)
    const pending = runReflectionAction(
      "/api/reflection/promote",
      { method: "POST" },
      undefined,
      controller.signal
    )
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, outcomeUnknown: true })
    expect(pollSignal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
