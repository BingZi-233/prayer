import type { ReflectionEntry } from "../../core/db/models"
import { splitCompactedFaq } from "./compact-chunks"

/** 整理来源只有在原 FAQ 的全部检索块仍获准保留时才能用于升格。 */
export function promotionSourceAnswer(
  entry: ReflectionEntry,
  siblings: ReflectionEntry[]
): string | null {
  if (entry.chatId !== "0") return entry.answer
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
