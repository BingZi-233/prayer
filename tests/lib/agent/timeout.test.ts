import { describe, expect, it } from "vitest"
import {
  DEFAULT_EMBED_TIMEOUT_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  withTimeout,
  withTimeoutFn,
} from "@/lib/agent/timeout"

describe("withTimeout", () => {
  it("任务先完成 → 返回其值", async () => {
    await expect(withTimeout(1_000, Promise.resolve(42))).resolves.toBe(42)
  })

  it("任务超时 → 拒绝并放弃等待", async () => {
    await expect(
      withTimeout(20, new Promise<string>(() => {}))
    ).rejects.toThrow("超时")
  })

  it("ms<=0 关闭超时:原 promise 引用透传", () => {
    const p = Promise.resolve(1)
    expect(withTimeout(0, p)).toBe(p)
    expect(withTimeout(-1, p)).toBe(p)
  })

  it("默认值对齐:LLM 180s / embed 60s", () => {
    expect(DEFAULT_QUERY_TIMEOUT_MS).toBe(180_000)
    expect(DEFAULT_EMBED_TIMEOUT_MS).toBe(60_000)
  })
})

describe("withTimeoutFn", () => {
  it("包装后的调用超时拒绝;正常调用透传结果", async () => {
    const slow = async (t: string) => {
      await new Promise((r) => setTimeout(r, 500))
      return t.toUpperCase()
    }
    const wrapped = withTimeoutFn(20, slow)
    await expect(wrapped("ab")).rejects.toThrow("超时")

    const fast = async (t: string) => t.toUpperCase()
    await expect(withTimeoutFn(1_000, fast)("ab")).resolves.toBe("AB")
  })

  it("ms<=0 原样返回函数引用", () => {
    const f = async (t: string) => t
    expect(withTimeoutFn(0, f)).toBe(f)
  })
})
