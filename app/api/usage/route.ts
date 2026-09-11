import { NextResponse } from "next/server"
import { usageStats, cacheHitRatio, type UsageStat } from "@/lib/model/stats/usage"
import {
  toolStats,
  kbCoverage,
  shortToolName,
  RUN_TOTAL_TOOL,
  KB_PREFETCH_TOOL,
  KB_GROUNDED_TOOL,
  type KbCoverage,
  type ToolStat,
} from "@/lib/model/stats/tool"
import { getAppContext } from "@/lib/core/app-context"
import { ok } from "@/lib/core/api"

// 调用点中文名(与 lib/model/stats/usage.ts 的 UsageSite 对应);顺序即展示顺序
const SITE_ORDER = [
  "agent",
  "intent",
  "answerability",
  "reflect",
  "compact",
  "promote",
  "topic",
] as const
const SITE_LABEL: Record<string, string> = {
  agent: "主客服",
  intent: "意图分类",
  answerability: "可答判定",
  reflect: "反思沉淀",
  compact: "反思压缩",
  promote: "升格评审",
  topic: "问题归类",
}

const ZERO: UsageStat = {
  count: 0,
  cacheRead: 0,
  cacheCreation: 0,
  input: 0,
  output: 0,
  costUsd: 0,
}

function toRow(site: string, s: UsageStat) {
  return {
    site,
    label: SITE_LABEL[site] ?? site,
    ...s,
    hitRatio: cacheHitRatio(s),
  }
}

interface ToolRow extends ToolStat {
  tool: string
  toolLabel: string
  perRun: number
}

// 伪工具行的中文名(真实工具名走 shortToolName 剥 MCP 前缀)
const TOOL_LABEL: Record<string, string> = {
  [KB_PREFETCH_TOOL]: "知识库预检索注入",
  [KB_GROUNDED_TOOL]: "有知识库依据(注入或检索)",
}

/** __run__ 是覆盖率分母、不进表格;其余按调用次数降序 */
function toToolRows(stats: Record<string, ToolStat>): ToolRow[] {
  return Object.entries(stats)
    .filter(([tool]) => tool !== RUN_TOTAL_TOOL)
    .map(([tool, s]) => ({
      tool,
      toolLabel: TOOL_LABEL[tool] ?? shortToolName(tool),
      ...s,
      perRun: s.runs > 0 ? s.calls / s.runs : 0,
    }))
    .sort((a, b) => b.calls - a.calls)
}

/** 日表行(site/tool/runs/calls) → 与内存快照同形的 site → tool → stat */
function groupDailyTools(
  rows: { site: string; tool: string; runs: number; calls: number }[]
): Record<string, Record<string, ToolStat>> {
  const out: Record<string, Record<string, ToolStat>> = {}
  for (const r of rows) {
    out[r.site] ??= {}
    out[r.site][r.tool] = { runs: r.runs, calls: r.calls }
  }
  return out
}

function toolSection(stats: Record<string, ToolStat> | undefined): {
  rows: ToolRow[]
  coverage: KbCoverage
} {
  return {
    rows: toToolRows(stats ?? {}),
    coverage: kbCoverage(stats),
  }
}

// 本次进程运行以来的 LLM 用量/缓存命中 + 今日持久化汇总
// 始终返回全部已知调用点(零用量也展示),不再因空数据整表隐藏。
export async function GET(): Promise<NextResponse> {
  const snap = usageStats.snapshot()
  const known = new Set<string>(SITE_ORDER)
  const rows = [
    ...SITE_ORDER.map((site) => toRow(site, snap[site] ?? { ...ZERO })),
    // 未知 site 仍附在末尾,按成本降序
    ...Object.entries(snap)
      .filter(([site]) => !known.has(site))
      .map(([site, s]) => toRow(site, s))
      .sort((a, b) => b.costUsd - a.costUsd),
  ]
  const total = rows.reduce<UsageStat>(
    (a, r) => ({
      count: a.count + r.count,
      cacheRead: a.cacheRead + r.cacheRead,
      cacheCreation: a.cacheCreation + r.cacheCreation,
      input: a.input + r.input,
      output: a.output + r.output,
      costUsd: a.costUsd + r.costUsd,
    }),
    { ...ZERO }
  )

  // 工具调用:只看主客服站点(其余调用点本就 tools:[],无工具可记)
  const day = new Date().toISOString().slice(0, 10)
  const tools: {
    day: string
    process: { rows: ToolRow[]; coverage: KbCoverage }
    daily: { rows: ToolRow[]; coverage: KbCoverage }
  } = {
    day,
    process: toolSection(toolStats.snapshot().agent),
    daily: toolSection(undefined),
  }

  let daily: {
    day: string
    costUsd: number
    budgetUsd: number
    rows: { site: string; label: string; count: number; costUsd: number }[]
  } | null = null
  try {
    const { cfg, repo } = getAppContext()
    const drows = repo.usageDaily(day)
    daily = {
      day,
      costUsd: repo.usageDailyTotalCost(day),
      budgetUsd: cfg.usageBudgetUsd,
      rows: drows.map((r) => ({
        site: r.site,
        label: SITE_LABEL[r.site] ?? r.site,
        count: r.count,
        costUsd: r.costUsd,
      })),
    }
    tools.daily = toolSection(groupDailyTools(repo.toolStatsDaily(day)).agent)
  } catch {
    /* 持久化读失败不阻断内存快照 */
  }

  return NextResponse.json(
    ok({
      rows,
      total: { ...total, hitRatio: cacheHitRatio(total) },
      daily,
      tools,
    })
  )
}
