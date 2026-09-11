/**
 * JSON 任务双源解析:SDK structured_output 优先,assistant 文本 JSON 兜底。
 *
 * 背景:outputFormat.json_schema 在 CLI 侧要求模型调 StructuredOutput 工具;
 * MiniMax-M3 常只吐文本 JSON 而不调工具 → result.structured_output 为空。
 * intent/answerability 证明「prompt 约束 + 本地 parse」对 M3 很稳,故后台 JSON
 * 任务统一 structured 优先、文本兜底,业务形状仍由各调用方本地校验。
 *
 * maxTurns≥2 时 drainQuery 会把多轮 assistant 文本直接拼接成
 * `{"items":[...]}{"items":[...]}`,贪婪 /\{[\s\S]*\}/ 会匹配成非法 JSON,
 * 故用括号配对逐个取出,调用方取最后一个合法载荷。
 */

/** 括号配对找闭合位置(尊重字符串转义)。失败返回 -1。 */
export function findBalancedEnd(s: string, start: number): number {
  const open = s[start]
  if (open !== "{" && open !== "[") return -1
  const close = open === "{" ? "}" : "]"
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]!
    if (inString) {
      if (escape) escape = false
      else if (c === "\\") escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 从文本中抽出所有可 parse 的顶层 {...} 或 [...](按出现顺序)。 */
export function extractJsonValues(rawText: string): unknown[] {
  const out: unknown[] = []
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i]
    if (ch !== "{" && ch !== "[") continue
    const end = findBalancedEnd(rawText, i)
    if (end < 0) continue
    try {
      out.push(JSON.parse(rawText.slice(i, end + 1)))
    } catch {
      /* 跳过非法片段 */
    }
    i = end
  }
  return out
}

/** 从数组开括号后 salvage 完整顶层对象(跳过截断中的半条)。 */
export function salvageArrayObjects(s: string, arrayStart: number): unknown[] {
  const items: unknown[] = []
  let i = arrayStart + 1
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++
    if (i >= s.length || s[i] === "]") break
    if (s[i] !== "{") break
    const end = findBalancedEnd(s, i)
    if (end < 0) break
    try {
      items.push(JSON.parse(s.slice(i, end + 1)))
    } catch {
      break
    }
    i = end + 1
  }
  return items
}

export type DualArrayResult = {
  items: unknown[]
  /** true=文本路径外层数组未闭合,仅 salvage 到完整对象 */
  truncated: boolean
  /** structured | text */
  source: "structured" | "text"
}

/**
 * 从 structured / 文本抽出数组字段(如 items / decisions)。
 * - structured 优先:对象带 field 数组,或(allowBareArray)本身为数组
 * - 否则扫文本:最后一个带 field 的对象,或最后一个裸数组(allowBareArray)
 * - salvageTruncated:文本数组未闭合时 salvage 完整对象
 */
export function pickArrayFieldDual(
  structured: unknown | undefined | null,
  rawText: string,
  field: string,
  opts: { allowBareArray?: boolean; salvageTruncated?: boolean } = {}
): DualArrayResult | null {
  const allowBare = opts.allowBareArray ?? true
  const salvage = opts.salvageTruncated ?? false

  if (structured !== undefined && structured !== null) {
    if (allowBare && Array.isArray(structured)) {
      return { items: structured, truncated: false, source: "structured" }
    }
    if (
      typeof structured === "object" &&
      Array.isArray((structured as Record<string, unknown>)[field])
    ) {
      return {
        items: (structured as Record<string, unknown>)[field] as unknown[],
        truncated: false,
        source: "structured",
      }
    }
    // structured 形状不对 → 仍尝试文本兜底(模型可能同时吐了合法文本)
  }

  const text = rawText ?? ""
  if (!text.trim()) return null

  // 完整 JSON 值:取最后一个合法 field / 裸数组
  const values = extractJsonValues(text)
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Array.isArray((v as Record<string, unknown>)[field])
    ) {
      return {
        items: (v as Record<string, unknown>)[field] as unknown[],
        truncated: false,
        source: "text",
      }
    }
    if (allowBare && Array.isArray(v)) {
      return { items: v, truncated: false, source: "text" }
    }
  }

  if (!salvage) return null

  // 截断 salvage:优先对象内 field 数组,再裸数组
  const objStart = text.indexOf("{")
  const arrStart = text.indexOf("[")
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    // 尝试定位 "field":[
    const key = `"${field}"`
    const keyIdx = text.indexOf(key, objStart)
    if (keyIdx >= 0) {
      let j = keyIdx + key.length
      while (j < text.length && /[\s:]/.test(text[j]!)) j++
      if (text[j] === "[") {
        const salvaged = salvageArrayObjects(text, j)
        if (salvaged.length > 0) {
          return { items: salvaged, truncated: true, source: "text" }
        }
      }
    }
  }
  if (arrStart >= 0) {
    const end = findBalancedEnd(text, arrStart)
    if (end < 0) {
      const salvaged = salvageArrayObjects(text, arrStart)
      if (salvaged.length > 0) {
        return { items: salvaged, truncated: true, source: "text" }
      }
    }
  }
  return null
}

/** 预览日志用:优先文本,否则 structured 的 JSON 截断。 */
export function previewJsonPayload(
  structured: unknown | undefined | null,
  rawText: string,
  max = 300
): string {
  const t = (rawText || "").trim()
  if (t) return t.slice(0, max).replace(/\s+/g, " ")
  return JSON.stringify(structured ?? "")
    .slice(0, max)
    .replace(/\s+/g, " ")
    .trim()
}
