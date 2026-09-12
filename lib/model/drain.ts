import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { usageStats, type UsageSite, type UsageDelta } from "./stats/usage"
import { isStructuredOutputTool } from "./tool-policy"
import {
  consumeAssistantContent,
  finalAssistantText,
  type AssistantTextState,
} from "./final-text"

// usage 提取只依赖这几个字段;SDK result 消息 / 测试桩的形状都落在这个子集上。
// 末尾三个可选字段兼容 SDK>=0.3.222 新增的 SDKTaskNotificationMessage.usage 形状
// (total_tokens/tool_uses/duration_ms),使 SDKMessage 全 union 可直接传入;
// 函数内 type!=="result" 守卫照常过滤,不会误取任务通知的 usage。
export interface ResultUsageLike {
  type?: string
  usage?: {
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    tool_uses?: number
    duration_ms?: number
  }
  total_cost_usd?: unknown
}

// 从 SDK 末尾 result 消息(SDKResultSuccess)提取用量增量;非 result 或无 usage → undefined
export function usageFromResult(
  msg: ResultUsageLike | null | undefined
): UsageDelta | undefined {
  if (!msg || msg.type !== "result") return undefined
  const u = msg.usage ?? {}
  return {
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheCreation: u.cache_creation_input_tokens ?? 0,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : 0,
  }
}

export interface DrainResult {
  text: string
  sessionId?: string
  usage?: UsageDelta
  /** outputFormat:json_schema 时抽出的结构化结果(见 drainQuery 优先级) */
  structuredOutput?: unknown
}

/**
 * 从 SDK 消息流抽出 StructuredOutput 载荷。
 * 优先级(流内后写覆盖前写,与 CLI 发射顺序一致):
 *   1) assistant tool_use name=StructuredOutput 的 input
 *   2) attachment type=structured_output 的 data(CLI schema 校验通过后)
 *   3) result.structured_output(SDK 终态,最权威)
 * 强制路径下模型常只调工具不吐文本;只读 result 会在部分失败/中断形态丢数据。
 */
// 流内结构化载荷的载体形状(assistant tool_use / attachment / result 三种来源的取用子集)
interface StructuredCarrier {
  type?: string
  message?: { content?: unknown }
  attachment?: unknown
  structured_output?: unknown
}

function pickStructuredFromMessage(msg: unknown): unknown | undefined {
  if (!msg || typeof msg !== "object") return undefined
  const m = msg as StructuredCarrier
  if (m.type === "assistant" && Array.isArray(m.message?.content)) {
    let found: unknown | undefined
    const blocks = m.message.content as {
      type?: string
      name?: unknown
      input?: unknown
    }[]
    for (const b of blocks) {
      if (
        b?.type === "tool_use" &&
        isStructuredOutputTool(String(b.name ?? "")) &&
        b.input !== undefined
      ) {
        found = b.input
      }
    }
    return found
  }
  // 流消息可能是 {type:"attachment", attachment:{type:"structured_output", data}}
  // 或扁平 {type:"attachment", ...fields} / 直接带 attachment 字段
  if (m.type === "attachment") {
    const att = (
      m.attachment && typeof m.attachment === "object" ? m.attachment : m
    ) as { type?: string; data?: unknown }
    if (att.type === "structured_output" && att.data !== undefined)
      return att.data
  }
  const nested = m.attachment as { type?: string; data?: unknown } | undefined
  if (nested?.type === "structured_output" && nested.data !== undefined) {
    return nested.data
  }
  if (m.type === "result" && m.structured_output !== undefined) {
    return m.structured_output
  }
  return undefined
}

// 单次迭代 query 结果流:累计 assistant 文本 + 抓 session_id + 抓末尾 result 的用量并记账。
// 若启用 outputFormat.json_schema,按 tool_use / attachment / result 多源抓 structured_output。
// 抛错语义保留:迭代中断直接向上抛(供一次性调用方的 fail-open/closed / 反思不推进游标依赖)。
// 主 agent 因有降级需求(保留部分文本)不走此助手,单独在 run 内联同款记账。
export async function drainQuery(
  iter: AsyncIterable<unknown>,
  site: UsageSite
): Promise<DrainResult> {
  const textState: AssistantTextState = { text: "" }
  let sessionId: string | undefined
  let usage: UsageDelta | undefined
  let structuredOutput: unknown | undefined
  for await (const raw of iter) {
    // 生产为 SDKMessage;测试桩是形状子集,仅编译期断言,不改变运行时
    const msg = raw as SDKMessage
    if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
      sessionId = msg.session_id
    } else if (
      msg.type === "assistant" &&
      Array.isArray(msg.message?.content)
    ) {
      consumeAssistantContent(textState, msg.message.content)
    }
    const so = pickStructuredFromMessage(msg)
    if (so !== undefined) structuredOutput = so
    const u = usageFromResult(msg)
    if (u) usage = u
  }
  if (usage) usageStats.record(site, usage)
  return { text: finalAssistantText(textState), sessionId, usage, structuredOutput }
}
