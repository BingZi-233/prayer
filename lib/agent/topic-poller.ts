import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
import { bus } from "../bus"
import type { Repo } from "../db/repo"
import { embed as defaultEmbed } from "../tools/embed"
import { noToolQueryOptions, drainQuery } from "./agent"
import { textNearlySame } from "./reflection-poller"

// LLM 每条问题的归类结果:归入已有 topicId / 新建 newTitle / 噪声 noise。
export interface ClassifyItem {
  i: number
  topicId?: number
  newTitle?: string
}

// 从 structured_output(优先)或原始文本中抽出 items 数组。
function rawItems(structured: unknown, rawText: string): unknown[] | null {
  if (structured && typeof structured === "object" && Array.isArray((structured as any).items)) {
    return (structured as any).items
  }
  if (Array.isArray(structured)) return structured
  // 文本兜底:匹配 {"items":[...]} 或裸数组
  const objMatch = rawText.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const v = JSON.parse(objMatch[0])
      if (v && Array.isArray(v.items)) return v.items
    } catch {
      /* fall through */
    }
  }
  const arrMatch = rawText.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      const v = JSON.parse(arrMatch[0])
      if (Array.isArray(v)) return v
    } catch {
      /* noop */
    }
  }
  return null
}

// 解析 + 对齐 + 校验。batchLen=本轮问题条数,existingIds=本轮传入 LLM 的现有主题 id 集。
// 返回对齐后的合法归类项(noise/非法项已剔除);解析失败返回 null(调用方本轮跳过、不推进游标)。
export function classifyItems(
  structured: unknown,
  rawText: string,
  batchLen: number,
  existingIds: Set<number>
): ClassifyItem[] | null {
  const items = rawItems(structured, rawText)
  if (!items) return null
  const seen = new Set<number>()
  const out: ClassifyItem[] = []
  for (const it of items) {
    if (!it || typeof it !== "object") continue
    const rec = it as Record<string, unknown>
    const i = rec.i
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= batchLen) continue
    if (seen.has(i)) continue
    if (rec.noise === true) {
      seen.add(i)
      continue
    }
    if (typeof rec.topicId === "number" && existingIds.has(rec.topicId)) {
      seen.add(i)
      out.push({ i, topicId: rec.topicId })
      continue
    }
    if (typeof rec.newTitle === "string" && rec.newTitle.trim()) {
      seen.add(i)
      out.push({ i, newTitle: rec.newTitle.trim() })
      continue
    }
    // 既非合法 topicId 也无 newTitle(含幻觉 id)→ 丢弃
    seen.add(i)
  }
  return out
}
