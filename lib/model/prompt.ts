import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { sanitizeForModel } from "./sanitize-input"

/**
 * embed 前的查询文本截断:整句语义足够,过长反而稀释向量。
 * 定义在此(而非 kb-prefetch):prompt 构造要用它截断探针文本,留在知识层会
 * 让 model 反向依赖 knowledge。
 */
export const PROBE_MAX_CHARS = 1000

export interface AgentMedia {
  images?: { data: string; mediaType: string }[]
  quoted?: string
  forwarded?: string
}

// 折叠引用/转发为文本前言,与正文拼接;用户侧文本一律 sanitize,防 MiniMax new_sensitive
function foldPreamble(text: string, media?: AgentMedia): string {
  const clean = (value: string): string => {
    let out = sanitizeForModel(value)
    for (const marker of AGENT_PROMPT_MARKERS) {
      out = out.split(marker).join("")
    }
    return out
  }
  return [
    media?.quoted && `【用户引用了一条消息:${clean(media.quoted)}】`,
    media?.forwarded && `【用户转发的合并消息:\n${clean(media.forwarded)}】`,
    clean(text),
  ]
    .filter(Boolean)
    .join("\n")
}

export const KB_CANDIDATES_BEGIN = "<<<SYSTEM_KB_CANDIDATES>>>"
export const KB_CANDIDATES_END = "<<<END_SYSTEM_KB_CANDIDATES>>>"
export const USER_MESSAGE_BEGIN = "<<<UNTRUSTED_CUSTOMER_MESSAGE>>>"
export const USER_MESSAGE_END = "<<<END_UNTRUSTED_CUSTOMER_MESSAGE>>>"

const AGENT_PROMPT_MARKERS = [
  KB_CANDIDATES_BEGIN,
  KB_CANDIDATES_END,
  USER_MESSAGE_BEGIN,
  USER_MESSAGE_END,
] as const

function stripAgentPromptMarkers(value: string): string {
  let out = value
  for (const marker of AGENT_PROMPT_MARKERS) {
    out = out.split(marker).join("")
  }
  return out
}

// Anthropic Base64ImageSource 允许的 media_type 全集(见 @anthropic-ai/sdk ImageBlockParam);
// enrich/tg 只收 image/*,运行时值必落在并集内,此处仅作类型窄化
type Base64MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp"

/**
 * 预检索送去 embed 的查询文本:剥掉主动模式的固定指令(约 90 字模板,不剥会
 * 主导短问题的向量、把检索质量带偏),带上引用消息(引用的往往才是真问题)。
 * 转发内容太长且噪声大,不进 query(仍进 prompt)。
 */
export function kbProbeText(text: string, media?: AgentMedia): string {
  let body = text.trim()
  if (body.startsWith(PROACTIVE_SUFFIX)) {
    body = body.slice(PROACTIVE_SUFFIX.length).trim()
  }
  return [media?.quoted?.trim(), body]
    .filter(Boolean)
    .join("\n")
    .slice(0, PROBE_MAX_CHARS)
}

// 有图 → 多模态 prompt(AsyncIterable<SDKUserMessage>);无图 → 字符串
// kbBlock:预检索注入块,拼在最前(空串则完全不拼,行为与未开预检索逐字一致)
export function buildPrompt(
  text: string,
  media?: AgentMedia,
  kbBlock = ""
): string | AsyncIterable<SDKUserMessage> {
  const kbSection = kbBlock
    ? `${KB_CANDIDATES_BEGIN}\n${stripAgentPromptMarkers(kbBlock)}\n${KB_CANDIDATES_END}`
    : ""
  const userSection = `${USER_MESSAGE_BEGIN}\n${foldPreamble(text, media) || "(空消息)"}\n${USER_MESSAGE_END}`
  // 资料在前、具体任务在最后,降低长上下文中任务丢失;图片 block 紧随本段,
  // system prompt 已声明图片同属不可信用户输入。
  const head = [
    kbSection,
    userSection,
    "本轮任务:根据系统规则回应上方用户消息。",
  ]
    .filter(Boolean)
    .join("\n\n")
  const images = media?.images ?? []
  if (images.length === 0) return head
  return (async function* (): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          { type: "text", text: head || "(图片)" },
          ...images.map((im) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: im.mediaType as Base64MediaType,
              data: im.data,
            },
          })),
        ],
      },
    }
  })()
}

// 主动模式哨兵:无把握时 agent 只输出此串。任何出站路径命中都必须吞掉,绝不可发给用户。
export const NO_ANSWER_SENTINEL = "__NO_ANSWER__"

// 主动模式指令:未答复轮询拼在 user prompt 首段(非 system),
// 使主动/正常两条路径共享同一 system 前缀、TTL 内可跨路径命中缓存。
// 定义在此而非 poller:预检索要按它剥前缀取干净 query(见 kbProbeText),放 poller 会成环。
export const PROACTIVE_SUFFIX = `【主动模式】你是在无人应答时主动补位。仅当知识库检索到确切依据且你有把握时才作答;否则只输出 ${NO_ANSWER_SENTINEL}(不解释、不道歉、不引导人工或外链、不寒暄)。`

/** 文本是否含主动模式「不回答」哨兵(含子串,防前后缀/混排泄漏)。 */
export function isNoAnswerText(text: string): boolean {
  return text.includes(NO_ANSWER_SENTINEL)
}
