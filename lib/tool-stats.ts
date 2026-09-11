// 按工具名的调用统计。lib/usage-stats.ts 的姊妹模块,刻意分开:
//   1) 维度不同 —— usage 是「site → 6 个累加数」,tool 是「site → tool → {runs, calls}」两层;
//   2) 时机不同 —— usage 在末尾 result 消息即时记账,tool 必须攒完整个 run 再一次性提交
//      (runs 的语义是「出现过该工具的 run 数」,每 run 每工具最多 +1)。
// 同样是 globalThis 单例 + 可选 SQLite 日表持久化。

import type { Repo } from "./core/db/repo"

/** 总 run 数特殊行:覆盖率的分母 */
export const RUN_TOTAL_TOOL = "__run__"
/** 伪工具行:本 run 注入过预检索 KB 块(见 lib/agent/kb-prefetch.ts) */
export const KB_PREFETCH_TOOL = "__kb_prefetch__"
/**
 * 伪工具行:本 run「有知识库依据」—— 注入过 或 调过 kb_search。
 * 按行聚合拿不到二者的交集,所以在写入端就把并集算好,UI 直接读。
 * 这是头条指标:预检索上线后模型不必再调 kb_search,单看 kb_search 比例必然下跌,
 * 那是预期的好事,别拿它当回归信号。
 */
export const KB_GROUNDED_TOOL = "__kb_grounded__"

export interface ToolStat {
  /** 出现过该工具的 run 数 */
  runs: number
  /** 总调用次数 */
  calls: number
}

/** site → tool → stat */
export type ToolStatsSnapshot = Record<string, Record<string, ToolStat>>

export interface ToolStatRow extends ToolStat {
  tool: string
}

type PersistHook = (site: string, rows: ToolStatRow[]) => void

class ToolStats {
  private m = new Map<string, Map<string, ToolStat>>()
  private persist?: PersistHook

  setPersist(hook?: PersistHook): void {
    this.persist = hook
  }

  /**
   * 提交一次 run 的工具调用。calls 为「工具名 → 本 run 内调用次数」,可为空。
   * 内部自动补 __run__ 行(runs +1、calls += 本 run 全部调用次数之和)。
   */
  recordRun(site: string, calls: Record<string, number>): void {
    const rows: ToolStatRow[] = []
    let total = 0
    for (const [tool, n] of Object.entries(calls)) {
      if (n <= 0) continue
      // 伪工具行(__ 前缀)不计入总调用数,否则「每轮平均工具调用数」会被自己污染
      if (!tool.startsWith("__")) total += n
      rows.push({ tool, runs: 1, calls: n })
    }
    rows.push({ tool: RUN_TOTAL_TOOL, runs: 1, calls: total })

    const bySite = this.m.get(site) ?? new Map<string, ToolStat>()
    for (const r of rows) {
      const cur = bySite.get(r.tool) ?? { runs: 0, calls: 0 }
      cur.runs += r.runs
      cur.calls += r.calls
      bySite.set(r.tool, cur)
    }
    this.m.set(site, bySite)

    try {
      this.persist?.(site, rows)
    } catch {
      /* 持久化失败不阻断主链路 */
    }
  }

  snapshot(): ToolStatsSnapshot {
    const out: ToolStatsSnapshot = {}
    for (const [site, bySite] of this.m) {
      const tools: Record<string, ToolStat> = {}
      for (const [tool, s] of bySite) tools[tool] = { ...s }
      out[site] = tools
    }
    return out
  }

  reset(): void {
    this.m.clear()
  }
}

const g = globalThis as unknown as { __toolStats?: ToolStats }
export const toolStats: ToolStats =
  g.__toolStats ?? (g.__toolStats = new ToolStats())

export interface KbCoverage {
  totalRuns: number
  /** 有知识库依据(注入 或 kb_search)的 run 数 */
  groundedRuns: number
  /** 其中模型自己调 kb_search 的 run 数 */
  searchRuns: number
  /** 其中系统预检索注入过的 run 数 */
  prefetchRuns: number
  ratio: number
}

/** cs 插件的 kb_search MCP 全名;与 lib/agent/agent.ts 的 CS_KB_TOOL 一致 */
const KB_SEARCH_SUFFIX = "__kb_search"

/** 知识库覆盖率:有依据的 run 数 / 总 run 数 */
export function kbCoverage(
  siteStats: Record<string, ToolStat> | undefined
): KbCoverage {
  const get = (tool: string): number => siteStats?.[tool]?.runs ?? 0
  const totalRuns = get(RUN_TOTAL_TOOL)
  const searchRuns = Object.entries(siteStats ?? {})
    .filter(([tool]) => tool.endsWith(KB_SEARCH_SUFFIX))
    .reduce((a, [, s]) => a + s.runs, 0)
  const prefetchRuns = get(KB_PREFETCH_TOOL)
  const groundedRuns = get(KB_GROUNDED_TOOL)
  return {
    totalRuns,
    groundedRuns,
    searchRuns,
    prefetchRuns,
    ratio: totalRuns > 0 ? groundedRuns / totalRuns : 0,
  }
}

/** mcp__plugin_cs_cs__kb_search → kb_search;仅展示用,落库仍存原名 */
export function shortToolName(name: string): string {
  if (!name.startsWith("mcp__")) return name
  const i = name.lastIndexOf("__")
  return i > 0 ? name.slice(i + 2) : name
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

/** 绑定 repo 做日持久化。返回 unbind。 */
export function bindToolStatsPersistence(repo: Repo): () => void {
  toolStats.setPersist((site, rows) => {
    repo.addToolStatsDaily(dayKey(), site, rows)
  })
  return () => toolStats.setPersist(undefined)
}
