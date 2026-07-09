// LLM 用量/缓存命中聚合器。仿 lib/logger.ts 的 globalThis 单例:热重载/多次 import 复用同一实例。
// 内存滚动累计 + 可选 SQLite 日表持久化(bindUsagePersistence)。

import type { Repo } from "./db/repo";

// 调用点标识:与 5 个 query() 站点一一对应(introspect 不产生模型调用,不计)
export type UsageSite = "agent" | "intent" | "answerability" | "reflect" | "compact";

// 单次调用从 SDK result 消息提取的增量
export interface UsageDelta {
  cacheRead: number; // cache_read_input_tokens:命中缓存、约 0.1x 计费
  cacheCreation: number; // cache_creation_input_tokens:写缓存、约 1.25x 计费
  input: number; // input_tokens:未缓存、全价
  output: number; // output_tokens
  costUsd: number; // result.total_cost_usd
}

export interface UsageStat extends UsageDelta {
  count: number; // 累计调用次数
}

export type UsageSnapshot = Record<string, UsageStat>;

const EMPTY: UsageStat = {
  count: 0,
  cacheRead: 0,
  cacheCreation: 0,
  input: 0,
  output: 0,
  costUsd: 0,
};

type PersistHook = (site: string, d: UsageDelta) => void;

class UsageStats {
  private m = new Map<string, UsageStat>();
  private persist?: PersistHook;

  setPersist(hook?: PersistHook): void {
    this.persist = hook;
  }

  record(site: string, d: UsageDelta): void {
    const cur = this.m.get(site) ?? { ...EMPTY };
    cur.count += 1;
    cur.cacheRead += d.cacheRead || 0;
    cur.cacheCreation += d.cacheCreation || 0;
    cur.input += d.input || 0;
    cur.output += d.output || 0;
    cur.costUsd += d.costUsd || 0;
    this.m.set(site, cur);
    try {
      this.persist?.(site, d);
    } catch {
      /* 持久化失败不阻断主链路 */
    }
  }

  snapshot(): UsageSnapshot {
    const out: UsageSnapshot = {};
    for (const [k, v] of this.m) out[k] = { ...v };
    return out;
  }

  reset(): void {
    this.m.clear();
  }
}

const g = globalThis as unknown as { __usageStats?: UsageStats };
export const usageStats: UsageStats = g.__usageStats ?? (g.__usageStats = new UsageStats());

// 缓存命中率 = 命中 / (命中 + 写入 + 未缓存)。写入(首轮)与未缓存都算未命中。
export function cacheHitRatio(s: UsageStat): number {
  const denom = s.cacheRead + s.cacheCreation + s.input;
  return denom > 0 ? s.cacheRead / denom : 0;
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** 绑定 repo 做日持久化 + 可选预算告警。返回 unbind。 */
export function bindUsagePersistence(
  repo: Repo,
  opts: {
    budgetUsd?: number;
    onBudgetExceeded?: (day: string, cost: number) => void;
  } = {}
): () => void {
  let alertedDay: string | null = null;
  const hook: PersistHook = (site, d) => {
    const day = dayKey();
    repo.addUsageDaily(day, site, {
      count: 1,
      cacheRead: d.cacheRead || 0,
      cacheCreation: d.cacheCreation || 0,
      input: d.input || 0,
      output: d.output || 0,
      costUsd: d.costUsd || 0,
    });
    const budget = opts.budgetUsd ?? 0;
    if (budget > 0 && opts.onBudgetExceeded) {
      const total = repo.usageDailyTotalCost(day);
      if (total >= budget && alertedDay !== day) {
        alertedDay = day;
        opts.onBudgetExceeded(day, total);
      }
    }
  };
  usageStats.setPersist(hook);
  return () => usageStats.setPersist(undefined);
}
