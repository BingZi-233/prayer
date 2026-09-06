/**
 * PackyAPI 输出层 —— 全部 format* 函数,把 pricing.ts 解析出的价格与
 * 原始数据渲染成极简结构化文本。只依赖 pricing.ts,不触网、不引 MCP SDK。
 *
 * 依赖方向单向:packy-mcp.ts → format.ts → pricing.ts。
 * 公告类型放这里而非 packy-mcp.ts:formatAnnouncements 是其唯一的结构化
 * 消费方,放这里可避免两个模块互相 import。
 */
import type { Pricing } from "./pricing.ts"

export interface Announcement {
  id: number
  category: string
  type: string
  title: string
  title_en: string
  content: string
  content_en: string
  publishDate: string
}

export interface Announcements {
  data: Announcement[]
}

function grValue(d: Pricing, group: string): number {
  return d.group_ratio?.[group] ?? 1
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

function padStart(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s
}

// —— 纯格式化函数:输入 Pricing + 参数,返回结构化文本(便于单测,不触网) ——

export function formatPrice(
  d: Pricing,
  opts: { keyword?: string; group?: string; base?: number } = {}
): string {
  const groupArg = opts.group
  const base = opts.base ?? 2
  const kw = (opts.keyword ?? "").toLowerCase()
  // 行:[model, group, in, out, cache, endpoints]
  const rows: string[][] = []
  for (const m of d.data) {
    if (kw && !m.model_name.toLowerCase().includes(kw)) continue
    let groups: string[]
    if (groupArg) {
      if (!m.enable_groups?.includes(groupArg)) continue
      groups = [groupArg]
    } else if (kw) {
      groups = m.enable_groups ?? []
    } else {
      groups = m.enable_groups?.includes("cc") ? ["cc"] : []
    }
    const ep = (m.supported_endpoint_types ?? []).join(",")
    for (const g of groups) {
      const gr = grValue(d, g)
      if (m.quota_type === 1) {
        rows.push([
          m.model_name,
          g,
          `$${(m.model_price * gr).toFixed(4)}/次`,
          "-",
          "-",
          ep,
        ])
      } else {
        const inp = m.model_ratio * gr * base
        const cache =
          m.cache_ratio === undefined
            ? "-"
            : `$${(inp * m.cache_ratio).toFixed(2)}`
        rows.push([
          m.model_name,
          g,
          `$${inp.toFixed(2)}`,
          `$${(inp * m.completion_ratio).toFixed(2)}`,
          cache,
          ep,
        ])
      }
    }
  }
  if (rows.length === 0) {
    return `无匹配(group=${groupArg ?? "自动"}, 关键词=${kw || "无"})`
  }
  const scope = groupArg
    ? `组 ${groupArg}(倍率 ${grValue(d, groupArg)})`
    : kw
      ? "各分组"
      : "组 cc"
  const out: string[] = [`# ${scope}, base ${base} — 单位 $/1M tokens`]
  out.push(
    `${pad("model", 32)} ${pad("group", 18)} ${padStart("in", 8)} ${padStart("out", 9)} ${padStart("cache", 8)}  endpoints`
  )
  const sorted = rows.sort(
    (a, b) => a[0].localeCompare(b[0]) || grValue(d, a[1]) - grValue(d, b[1])
  )
  for (const r of sorted) {
    out.push(
      `${pad(r[0], 32)} ${pad(r[1], 18)} ${padStart(r[2], 8)} ${padStart(r[3], 9)} ${padStart(r[4], 8)}  ${r[5]}`
    )
  }
  return out.join("\n")
}

export function formatModels(
  d: Pricing,
  opts: { group?: string; endpoint?: string } = {}
): string {
  const group = opts.group ?? "cc"
  const endpoint = opts.endpoint
  const names: string[] = []
  for (const m of d.data) {
    if (!m.enable_groups?.includes(group)) continue
    if (endpoint && !m.supported_endpoint_types?.includes(endpoint)) continue
    names.push(m.model_name)
  }
  const out: string[] = [
    `# group=${group}${endpoint ? ` endpoint=${endpoint}` : ""} — ${names.length} 个模型`,
  ]
  for (const n of names.sort((a, b) => a.localeCompare(b))) out.push(n)
  return out.join("\n")
}

export function formatGroups(d: Pricing): string {
  const gr = d.group_ratio ?? {}
  const desc = d.usable_group ?? {}
  const out: string[] = ["# 分组倍率(group_ratio)与说明"]
  for (const g of Object.keys(gr).sort((a, b) => gr[a] - gr[b])) {
    out.push(
      `${pad(g, 22)} x${pad(String(gr[g]), 5)} ${(desc[g] ?? "").trim()}`
    )
  }
  return out.join("\n")
}

export function formatRaw(d: Pricing, model?: string): string {
  if (!model) return "raw 需 model 参数"
  const m = d.data.find((x) => x.model_name === model)
  if (!m) return `未找到模型: ${model}`
  return JSON.stringify(m, null, 2)
}

export function formatAnnouncements(
  d: Announcements,
  opts: { keyword?: string; limit?: number } = {}
): string {
  const limit = opts.limit ?? 5
  const kw = (opts.keyword ?? "").toLowerCase()
  let list = [...(d.data ?? [])]
  if (kw) {
    list = list.filter(
      (a) =>
        a.title?.toLowerCase().includes(kw) ||
        a.content?.toLowerCase().includes(kw)
    )
  }
  // 按发布时间降序,取最近 limit 条
  list.sort((a, b) => (b.publishDate ?? "").localeCompare(a.publishDate ?? ""))
  const shown = list.slice(0, limit)
  if (shown.length === 0) {
    return `无公告(关键词=${kw || "无"})`
  }
  const out: string[] = [
    `# PackyAPI 公告 — 共 ${list.length} 条,列最近 ${shown.length} 条`,
  ]
  for (const a of shown) {
    const date = (a.publishDate ?? "").slice(0, 10)
    out.push("")
    out.push(`[${a.id}] ${a.title}  (${a.category}${date ? `, ${date}` : ""})`)
    out.push((a.content ?? "").trim())
  }
  return out.join("\n")
}
