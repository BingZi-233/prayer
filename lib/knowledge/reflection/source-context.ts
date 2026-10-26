import type { ReflectionEntry } from "../../core/db/models"
import { splitCompactedFaq } from "./compact-chunks"

/**
 * 存量整理块的截止时间(不含)。生产库里最后一批整理块的 ts 为 1792929187654,取其 + 1:
 * ts ≥ 截止的 chatId=0 条目是一次性拆分产物(answer 即原文逐字摘录),之前的是旧整理块。
 * 拆分脚本已删除,此常量只用于升格来源取值区分两类历史条目。
 */
export const LEGACY_SPLIT_CUTOFF = 1792929187655

/**
 * 升格来源取值:
 * - 普通反思(chatId≠0):原始回答;
 * - 一次性拆分产物(chatId 0 且 ts ≥ LEGACY_SPLIT_CUTOFF):answer 即原文逐字摘录
 *   (兜底条目为原文片段本身),直接作为来源,供成文核验;
 * - 旧整理块(chatId 0 且 ts < 截止):只有在原 FAQ 的全部检索块仍获准保留时才能用于升格。
 */
export function promotionSourceAnswer(
  entry: ReflectionEntry,
  siblings: ReflectionEntry[]
): string | null {
  if (entry.chatId !== "0") return entry.answer
  if (entry.ts != null && entry.ts >= LEGACY_SPLIT_CUTOFF) return entry.answer
  if (!entry.answer || entry.ts == null || entry.status !== "approved")
    return null

  const pieces = splitCompactedFaq(entry.answer)
  const group = siblings.filter(
    (sibling) =>
      sibling.chatId === "0" &&
      sibling.channel === entry.channel &&
      sibling.ts === entry.ts &&
      sibling.answer === entry.answer
  )
  if (
    group.length !== pieces.length ||
    !group.some(
      (sibling) => sibling.id === entry.id && sibling.content === entry.content
    )
  )
    return null

  const remaining = new Map<string, number>()
  for (const piece of pieces)
    remaining.set(piece, (remaining.get(piece) ?? 0) + 1)
  const ids = new Set<number>()
  for (const sibling of group) {
    const count = remaining.get(sibling.content) ?? 0
    if (sibling.status !== "approved" || ids.has(sibling.id) || count === 0)
      return null
    ids.add(sibling.id)
    remaining.set(sibling.content, count - 1)
  }
  return entry.answer
}
