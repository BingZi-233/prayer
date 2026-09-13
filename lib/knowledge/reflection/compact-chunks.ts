/**
 * 反思整理结果写入向量库前的分块规则。
 *
 * 生产 ingest 会先按空行分段，再对超长段落做固定长度硬切；整理路径必须
 * 复用同一语义，否则反思条目会绕过 500 字边界，生成无法稳定检索的超长向量。
 */
export const DEFAULT_KB_CHUNK_MAX_CHARS = 500

export function splitCompactedFaq(
  text: string,
  maxLen = DEFAULT_KB_CHUNK_MAX_CHARS
): string[] {
  if (!Number.isFinite(maxLen) || maxLen <= 0) {
    throw new RangeError("maxLen must be a positive finite number")
  }
  const size = Math.floor(maxLen)
  if (size <= 0) {
    throw new RangeError("maxLen must be at least one character")
  }
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const chunks: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= size) {
      chunks.push(paragraph)
      continue
    }
    for (let offset = 0; offset < paragraph.length; offset += size) {
      chunks.push(paragraph.slice(offset, offset + size))
    }
  }
  return chunks
}
