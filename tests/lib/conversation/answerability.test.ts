import { describe, it, expect, vi } from "vitest"
import { makeAnswerabilityClassifier } from "@/lib/conversation/answerability"

// 假 query:产出单条 assistant JSON 文本
function fakeQuery(text: string) {
  return () =>
    (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text }] },
      }
    })()
}

describe("answerability 判官", () => {
  it("产品问题 → answerable", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: fakeQuery('{"answer":true}') as never,
    })
    expect(await c("claude 的价格多少?")).toEqual({ decision: "answerable" })
  })

  it("闲聊/无关 → not_answerable", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: fakeQuery('{"answer":false}') as never,
    })
    expect(await c("今天天气不错")).toEqual({ decision: "not_answerable" })
  })

  it("空文本 → false,不调用 LLM", async () => {
    const qf = vi.fn(fakeQuery('{"answer":true}'))
    const c = makeAnswerabilityClassifier({ queryFn: qf as never })
    expect(await c("   ")).toEqual({ decision: "not_answerable" })
    expect(qf).not.toHaveBeenCalled()
  })

  it("非法输出 → error(invalid_output)", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: fakeQuery("抱歉无法处理") as never,
    })
    expect(await c("随便问问")).toEqual({
      decision: "error",
      reason: "invalid_output",
    })
  })

  it("LLM 抛错 → error(classifier_error)", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: (() => {
        throw new Error("boom")
      }) as never,
    })
    expect(await c("问题")).toEqual({
      decision: "error",
      reason: "classifier_error",
    })
  })

  it("cache 友好:tools=[] / skills=[] / strictMcpConfig", async () => {
    interface CapturedArgs {
      options: {
        tools: unknown[]
        skills: unknown[]
        strictMcpConfig: boolean
        mcpServers: Record<string, unknown>
      }
    }
    let seen!: CapturedArgs
    const capture = (arg: CapturedArgs) => {
      seen = arg
      return (async function* () {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: '{"answer":true}' }] },
        }
      })()
    }
    const c = makeAnswerabilityClassifier({ queryFn: capture as never })
    await c("价格多少")
    expect(seen.options.tools).toEqual([])
    expect(seen.options.skills).toEqual([])
    expect(seen.options.strictMcpConfig).toBe(true)
    expect(seen.options.mcpServers).toEqual({})
  })

  it("挂起的 LLM 在超时后 fail-closed → false(防 relay 挂起拖死兜底循环)", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: (() =>
        (async function* () {
          await new Promise(() => {}) // 永不产出:模拟 relay 挂起
        })()) as never,
      timeoutMs: 30,
    })
    const t0 = Date.now()
    expect(await c("价格多少")).toEqual({
      decision: "error",
      reason: "timeout",
    })
    // 远小于永不 settle 的等待:确实走了超时而非死等
    expect(Date.now() - t0).toBeLessThan(5_000)
  })
})
