import { describe, it, expect, beforeEach } from "vitest"
import { usageStats, cacheHitRatio } from "@/lib/usage-stats"
import { drainQuery, usageFromResult } from "@/lib/agent/agent"

beforeEach(() => usageStats.reset())

describe("usageStats", () => {
  it("record 累加、按站点分组、snapshot 深拷贝", () => {
    usageStats.record("intent", {
      cacheRead: 10,
      cacheCreation: 2,
      input: 3,
      output: 1,
      costUsd: 0.001,
    })
    usageStats.record("intent", {
      cacheRead: 5,
      cacheCreation: 0,
      input: 1,
      output: 1,
      costUsd: 0.001,
    })
    usageStats.record("agent", {
      cacheRead: 100,
      cacheCreation: 0,
      input: 0,
      output: 5,
      costUsd: 0.01,
    })
    const snap = usageStats.snapshot()
    expect(snap.intent).toEqual({
      count: 2,
      cacheRead: 15,
      cacheCreation: 2,
      input: 4,
      output: 2,
      costUsd: 0.002,
    })
    expect(snap.agent.count).toBe(1)
    // snapshot 是拷贝:改返回值不影响内部
    snap.intent.cacheRead = 0
    expect(usageStats.snapshot().intent.cacheRead).toBe(15)
  })

  it("cacheHitRatio = read/(read+creation+input)", () => {
    expect(
      cacheHitRatio({
        count: 1,
        cacheRead: 90,
        cacheCreation: 5,
        input: 5,
        output: 0,
        costUsd: 0,
      })
    ).toBeCloseTo(0.9)
    expect(
      cacheHitRatio({
        count: 0,
        cacheRead: 0,
        cacheCreation: 0,
        input: 0,
        output: 0,
        costUsd: 0,
      })
    ).toBe(0)
  })
})

describe("usageFromResult", () => {
  it("非 result 消息 → undefined", () => {
    expect(usageFromResult({ type: "assistant" })).toBeUndefined()
    expect(usageFromResult(null)).toBeUndefined()
  })
  it("result → 提取四类 token + cost,缺字段补 0", () => {
    expect(
      usageFromResult({
        type: "result",
        total_cost_usd: 0.5,
        usage: { input_tokens: 10, cache_read_input_tokens: 20 },
      })
    ).toEqual({
      cacheRead: 20,
      cacheCreation: 0,
      input: 10,
      output: 0,
      costUsd: 0.5,
    })
  })
})

describe("drainQuery", () => {
  it("累计文本 + 抓 session_id + 记账 result.usage", async () => {
    const iter = (async function* () {
      yield { type: "system", subtype: "init", session_id: "sid" }
      yield {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
          ],
        },
      }
      yield {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.02,
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          cache_read_input_tokens: 40,
          cache_creation_input_tokens: 1,
        },
      }
    })()
    const r = await drainQuery(iter, "reflect")
    expect(r.text).toBe("ab")
    expect(r.sessionId).toBe("sid")
    expect(r.structuredOutput).toBeUndefined()
    expect(usageStats.snapshot().reflect).toMatchObject({
      count: 1,
      input: 7,
      output: 3,
      cacheRead: 40,
      cacheCreation: 1,
      costUsd: 0.02,
    })
  })

  it("抓 result.structured_output(json_schema 路径)", async () => {
    const iter = (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "ignored" }] },
      }
      yield {
        type: "result",
        subtype: "success",
        structured_output: { items: [{ faq: "甲" }] },
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })()
    const r = await drainQuery(iter, "compact")
    expect(r.text).toBe("ignored")
    expect(r.structuredOutput).toEqual({ items: [{ faq: "甲" }] })
  })

  it("抓 StructuredOutput tool_use.input(强制路径、无文本)", async () => {
    const iter = (async function* () {
      yield {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "StructuredOutput",
              input: { items: [{ i: 0, noise: true }] },
            },
          ],
        },
      }
      yield {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })()
    const r = await drainQuery(iter, "topic")
    expect(r.text).toBe("")
    expect(r.structuredOutput).toEqual({ items: [{ i: 0, noise: true }] })
  })

  it("抓 attachment.structured_output.data;result 覆盖 tool_use", async () => {
    const iter = (async function* () {
      yield {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "StructuredOutput",
              input: { items: [{ i: 0, stale: true }] },
            },
          ],
        },
      }
      yield {
        type: "attachment",
        attachment: {
          type: "structured_output",
          data: { items: [{ i: 0, from: "attach" }] },
        },
      }
      yield {
        type: "result",
        subtype: "success",
        structured_output: { items: [{ i: 0, from: "result" }] },
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })()
    const r = await drainQuery(iter, "topic")
    expect(r.structuredOutput).toEqual({ items: [{ i: 0, from: "result" }] })
  })

  it("无 result.structured_output 时 attachment 兜底", async () => {
    const iter = (async function* () {
      yield {
        type: "attachment",
        attachment: {
          type: "structured_output",
          data: { items: [{ i: 1, topicId: 3 }] },
        },
      }
      yield {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })()
    const r = await drainQuery(iter, "topic")
    expect(r.structuredOutput).toEqual({ items: [{ i: 1, topicId: 3 }] })
  })

  it("无 result → 不记账,返回已累计文本", async () => {
    const iter = (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "x" }] },
      }
    })()
    const r = await drainQuery(iter, "compact")
    expect(r.text).toBe("x")
    expect(usageStats.snapshot().compact).toBeUndefined()
  })

  it("迭代中断向上抛(不吞错)", async () => {
    const iter = (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "x" }] },
      }
      throw new Error("boom")
    })()
    await expect(drainQuery(iter, "intent")).rejects.toThrow("boom")
  })
})
