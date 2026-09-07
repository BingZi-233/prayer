import type { ReflectionRow } from "./rows.ts"
import type { ReflectionStatus, ReflectionEntry } from "./models.ts"

/** 解析反思 source:新 human-reflection:{channel}:{chatId}:{ts};旧 human-reflection:{gid}:{ts}→qq */
export function parseReflectionSource(
  source: string | null
): { channel: string; chatId: string; ts: number } | null {
  if (!source?.startsWith("human-reflection:")) return null
  const rest = source.slice("human-reflection:".length)
  const parts = rest.split(":")
  // 新格式:至少 channel + chatId + ts
  if (parts.length >= 3) {
    const channel = parts[0]
    // 已知 channel 前缀,或非纯数字首段(避免把旧 gid 误当 channel)
    if (channel === "qq" || channel === "tg" || channel === "discord") {
      const ts = Number(parts[parts.length - 1])
      if (!Number.isFinite(ts)) return null
      const chatId = parts.slice(1, -1).join(":")
      if (!chatId) return null
      return { channel, chatId, ts }
    }
  }
  // 旧格式:human-reflection:{qqGroupId}:{ts}
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return { channel: "qq", chatId: parts[0], ts: Number(parts[1]) }
  }
  return null
}

/** 解析存库的 JSON 字符串数组;非法或非数组一律回退 [] */
export function parseStringArray(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// kb_chunks(reflection JOIN meta)行 → 反思条目视图;reflectionEntries/
// reflectionEntrySummaries/reflectionEntryDetail 三处共用,保证形状一致
export function mapReflectionRow(r: ReflectionRow): ReflectionEntry {
  const parsed = parseReflectionSource(r.source)
  return {
    id: r.id,
    content: r.content,
    channel: parsed?.channel ?? null,
    chatId: parsed?.chatId ?? null,
    ts: parsed?.ts ?? null,
    question: r.question,
    answer: r.answer,
    status: normalizeReflectionStatus(r.status),
  }
}

/** 无元数据或未知旧状态沿用 approved，避免历史知识在升级后消失。 */
export function normalizeReflectionStatus(
  status: string | null | undefined
): ReflectionStatus {
  return status === "rejected" || status === "pending" || status === "promoted"
    ? status
    : "approved"
}
