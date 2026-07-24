import { resolve, sep } from "node:path"

export const KB_DIR = "docs/kb"
export const KB_ROOT = resolve(KB_DIR)

/** 相对路径是否合法(无穿越、仅 .md/.txt、posix 分隔) */
export function isKbRelPath(rel: string): boolean {
  if (!rel || typeof rel !== "string") return false
  if (rel.includes("\0") || rel.includes("\\")) return false
  if (rel.startsWith("/") || rel.startsWith("./") || rel.startsWith("../"))
    return false
  const parts = rel.split("/")
  if (parts.some((p) => !p || p === "." || p === "..")) return false
  return rel.endsWith(".md") || rel.endsWith(".txt")
}

/** catch-all 段 → 相对 posix 路径 */
export function relFromParts(parts: string[]): string {
  return parts.map((p) => decodeURIComponent(p)).join("/")
}

/** 相对路径 → 绝对路径;非法返回 null */
export function safeKbAbs(rel: string): string | null {
  if (!isKbRelPath(rel)) return null
  const p = resolve(KB_DIR, rel)
  if (p !== KB_ROOT && !p.startsWith(KB_ROOT + sep)) return null
  return p
}
