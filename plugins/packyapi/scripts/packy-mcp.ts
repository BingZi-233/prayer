#!/usr/bin/env node
/**
 * PackyAPI MCP server —— 单工具 `packy`,走公开 JSON API 本地计价/过滤,输出极简结构化文本。
 * stdio transport。TypeScript 由 Node(v22.6+/24)原生 strip 运行。
 * SDK(@modelcontextprotocol/sdk)从 repo 根 node_modules 解析(本 plugin 在 prayer repo 内)。
 *
 * 工具 packy(action + 可选参数):
 *   action=price  [keyword] [group] [base]   计价 $/1M tokens
 *   action=models [endpoint] [group]         列可用模型 ID
 *   action=groups                            分组倍率与说明
 *   action=raw    model                       单模型原始 JSON
 *
 * 计价公式(new-api,quota_type=0 按量):
 *   input  $/1M = model_ratio * group_ratio * base   (base 默认 2,即 $0.002/1K)
 *   output $/1M = input * completion_ratio
 *   cache  $/1M = input * cache_ratio
 * quota_type=1(按次):  price/次 = model_price * group_ratio
 */

import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

export const API = "https://www.packyapi.ai/api/pricing"
export const ANNOUNCE_API = "https://www.packyapi.ai/api/announcements"

export interface Model {
  model_name: string
  quota_type: number
  model_ratio: number
  completion_ratio: number
  cache_ratio: number
  model_price: number
  enable_groups: string[]
  supported_endpoint_types: string[]
}

export interface Pricing {
  data: Model[]
  group_ratio: Record<string, number>
  usable_group: Record<string, string>
}

// 外部 API 硬超时:undici 默认可挂 5 分钟,而 agent run 总超时才 180s——
// 一次挂起的 packy 调用会把整条用户消息的处理拖死到 run 超时
const FETCH_TIMEOUT_MS = 10_000

async function fetchPricing(): Promise<Pricing> {
  const res = await fetch(API, {
    headers: { "User-Agent": "packy-mcp" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Pricing
}

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

async function fetchAnnouncements(): Promise<Announcements> {
  const res = await fetch(ANNOUNCE_API, {
    headers: { "User-Agent": "packy-mcp" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Announcements
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
        rows.push([
          m.model_name,
          g,
          `$${inp.toFixed(2)}`,
          `$${(inp * m.completion_ratio).toFixed(2)}`,
          `$${(inp * m.cache_ratio).toFixed(2)}`,
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

// —— MCP server ——

// server 版本随 plugin 走:读同插件 .claude-plugin/plugin.json,避免手改漂移。
function pluginVersion(scriptDir: string): string {
  try {
    const p = join(scriptDir, "..", ".claude-plugin", "plugin.json")
    return JSON.parse(readFileSync(p, "utf8")).version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const server = new McpServer({
  name: "packyapi",
  version: pluginVersion(dirname(fileURLToPath(import.meta.url))),
})

server.registerTool(
  "packy",
  {
    title: "PackyAPI 价格/模型查询",
    description:
      "查询 PackyAPI(Claude/OpenAI/Gemini 兼容的 AI API 中转平台)的模型价格、可用模型 ID、分组倍率与单模型原始数据。底层读公开 JSON /api/pricing,本地计价,输出极简结构化文本 —— 比抓 HTML 页面省 token 且精确。按 action 分四种查询,配合可选参数过滤。价格单位 $/1M tokens。",
    inputSchema: {
      action: z
        .enum(["price", "models", "groups", "raw", "announcements"])
        .describe(
          "查询类型:price=计价($/1M tokens,含 input/output/cache) / models=列可用模型 ID / groups=列全部分组倍率与说明 / raw=单模型完整原始 JSON / announcements=平台公告(上新、变更、通知)"
        ),
      keyword: z
        .string()
        .optional()
        .describe(
          "仅 price:按模型名子串过滤(不区分大小写);给了则列该模型在各可用分组下的价格,未给则默认只列 cc 组"
        ),
      group: z
        .string()
        .optional()
        .describe(
          "仅 price/models:锁定单个分组(如 cc、cc-sale),用 action=groups 可查全部分组名"
        ),
      endpoint: z
        .string()
        .optional()
        .describe("仅 models:按端点类型过滤,取值 anthropic / openai / gemini"),
      base: z
        .number()
        .optional()
        .describe(
          "仅 price:计价 base 系数,默认 2(即 $0.002/1K);input$ = model_ratio×group_ratio×base"
        ),
      model: z
        .string()
        .optional()
        .describe("仅 raw:精确模型 ID(必填,须与 models 列出的完全一致)"),
      limit: z
        .number()
        .optional()
        .describe(
          "仅 announcements:列出最近几条公告,默认 5;keyword 可同时按标题/正文子串过滤"
        ),
    },
  },
  async ({ action, keyword, group, endpoint, base, model, limit }) => {
    // announcements 走独立 API,不读 pricing
    if (action === "announcements") {
      try {
        const a = await fetchAnnouncements()
        return {
          content: [
            { type: "text", text: formatAnnouncements(a, { keyword, limit }) },
          ],
        }
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: "text", text: `取公告失败: ${(e as Error).message}` },
          ],
        }
      }
    }
    let d: Pricing
    try {
      d = await fetchPricing()
    } catch (e) {
      return {
        isError: true,
        content: [
          { type: "text", text: `取 API 失败: ${(e as Error).message}` },
        ],
      }
    }
    let text: string
    switch (action) {
      case "price":
        text = formatPrice(d, { keyword, group, base })
        break
      case "models":
        text = formatModels(d, { group, endpoint })
        break
      case "groups":
        text = formatGroups(d)
        break
      case "raw":
        if (!model) {
          return {
            isError: true,
            content: [{ type: "text", text: "raw 需 model 参数" }],
          }
        }
        text = formatRaw(d, model)
        break
    }
    return { content: [{ type: "text", text }] }
  }
)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// 直接运行时启动 stdio server;被 import(测试)时不启动。
// pathToFileURL 而非裸 `file://${argv[1]}` 拼接:路径含空格/需百分号编码字符,
// 或入口经 symlink(argv[1] 非 realpath)时裸拼接永远不成立 → 进程无声退出。
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
