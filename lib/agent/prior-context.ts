export const PRIOR_USER_CONTEXT_LIMIT = 10
export const PRIOR_CONTEXT_MAX_CHARS = 2000
export const PRIOR_LINE_MAX_CHARS = 400
export const EMPTY_AT_PLACEHOLDER =
  "（用户仅 @ 了 bot，无新正文；请结合近期发言作答）"

function normalizeLine(text: string, lineMax: number): string {
  let t = text.trim()
  if (t.length > lineMax) t = t.slice(0, lineMax - 1) + "…"
  return t
    .replace(/\n+/g, "\n")
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n")
}

/** texts 已是旧→新；从新到旧纳入直到 maxChars */
export function clipPriorTexts(
  texts: string[],
  maxChars: number,
  lineMax: number
): string[] {
  const kept: string[] = []
  let used = 0
  for (let i = texts.length - 1; i >= 0; i--) {
    const line = normalizeLine(texts[i], lineMax)
    const cost = line.length + 3 // "- " + newline estimate
    if (kept.length > 0 && used + cost > maxChars) break
    if (kept.length === 0 && cost > maxChars) {
      kept.push(line.slice(0, Math.max(1, maxChars - 1)) + "…")
      break
    }
    kept.push(line)
    used += cost
  }
  return kept.reverse()
}

export function formatPriorContext(
  prior: string[],
  currentBody: string
): string {
  if (!prior.length) return currentBody
  const lines = prior.map((p) => `- ${p}`).join("\n")
  const cur = currentBody.trim() ? currentBody.trim() : EMPTY_AT_PLACEHOLDER
  return `【用户近期发言（@前，旧→新）】\n${lines}\n【当前消息】\n${cur}`
}
