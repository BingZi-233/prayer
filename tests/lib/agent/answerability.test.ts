import { describe, it, expect, vi } from "vitest"
import { makeAnswerabilityClassifier } from "@/lib/agent/answerability"

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
  it("产品问题 → true", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: fakeQuery('{"answer":true}') as never,
    })
    expect(await c("claude 的价格多少?")).toBe(true)
  })

  it("闲聊/无关 → false", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: fakeQuery('{"answer":false}') as never,
    })
    expect(await c("今天天气不错")).toBe(false)
  })

  it("空文本 → false,不调用 LLM", async () => {
    const qf = vi.fn(fakeQuery('{"answer":true}'))
    const c = makeAnswerabilityClassifier({ queryFn: qf as never })
    expect(await c("   ")).toBe(false)
    expect(qf).not.toHaveBeenCalled()
  })

  it("非法输出 → false(fail-closed)", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: fakeQuery("抱歉无法处理") as never,
    })
    expect(await c("随便问问")).toBe(false)
  })

  it("LLM 抛错 → false(fail-closed)", async () => {
    const c = makeAnswerabilityClassifier({
      queryFn: (() => {
        throw new Error("boom")
      }) as never,
    })
    expect(await c("问题")).toBe(false)
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
})
