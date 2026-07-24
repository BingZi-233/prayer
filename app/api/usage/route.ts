import { NextResponse } from "next/server"
import { usageStats, cacheHitRatio, type UsageStat } from "@/lib/usage-stats"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { ok } from "@/lib/api"

// 调用点中文名(与 lib/usage-stats.ts 的 UsageSite 对应);顺序即展示顺序
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

  let daily: {
    day: string
    costUsd: number
    budgetUsd: number
    rows: { site: string; label: string; count: number; costUsd: number }[]
  } | null = null
  try {
    const cfg = getConfig(
      new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
    )
    const repo = new Repo(sharedDb(cfg.dbPath))
    const day = new Date().toISOString().slice(0, 10)
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
  } catch {
    /* 持久化读失败不阻断内存快照 */
  }

  return NextResponse.json(
    ok({ rows, total: { ...total, hitRatio: cacheHitRatio(total) }, daily })
  )
}
