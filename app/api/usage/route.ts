import { NextResponse } from "next/server";
import { usageStats, cacheHitRatio, type UsageStat } from "@/lib/usage-stats";
import { ok } from "@/lib/api";

// 调用点中文名(与 lib/usage-stats.ts 的 UsageSite 对应)
const SITE_LABEL: Record<string, string> = {
  agent: "主客服",
  intent: "意图分类",
  answerability: "可答判定",
  reflect: "反思沉淀",
  compact: "反思压缩",
};

const ZERO: UsageStat = { count: 0, cacheRead: 0, cacheCreation: 0, input: 0, output: 0, costUsd: 0 };

// 本次进程运行以来的 LLM 用量/缓存命中,按调用点分组。内存滚动,重启清零。
export async function GET(): Promise<NextResponse> {
  const snap = usageStats.snapshot();
  const rows = Object.entries(snap).map(([site, s]) => ({
    site,
    label: SITE_LABEL[site] ?? site,
    ...s,
    hitRatio: cacheHitRatio(s),
  }));
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
  );
  rows.sort((a, b) => b.costUsd - a.costUsd);
  return NextResponse.json(ok({ rows, total: { ...total, hitRatio: cacheHitRatio(total) } }));
}
