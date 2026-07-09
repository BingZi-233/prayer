import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig, type GroupPolicy } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";
import { buildGroupStatMaps } from "@/lib/reflect-stats";

// 生效群活动页:生效群 ∪ 有活动群,各群消息量/最近活动/反思游标/沉淀数 + 策略覆盖
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));

    const enabled = new Set(cfg.enabledGroups);
    const { cursors, msg, sed } = buildGroupStatMaps(repo);

    // 含有策略覆盖但尚未产生消息的群也要列出
    const policyIds = Object.keys(cfg.groupPolicies ?? {}).map(Number).filter((n) => !Number.isNaN(n));
    const ids = new Set<number>([...enabled, ...msg.keys(), ...policyIds]);
    const groups = [...ids]
      .map((groupId) => {
        const policy: GroupPolicy = cfg.groupPolicies[String(groupId)] ?? {};
        const hasOverride = Object.keys(policy).length > 0;
        return {
          groupId,
          enabled: enabled.has(groupId),
          messageCount: msg.get(groupId)?.count ?? 0,
          lastTs: msg.get(groupId)?.lastTs ?? 0,
          cursor: cursors.get(groupId) ?? 0,
          sedimentedCount: sed.get(groupId) ?? 0,
          policy,
          hasOverride,
          // 生效后的解析值(便于列表一眼看)
          effective: {
            proactiveEnabled:
              policy.proactiveEnabled !== undefined ? policy.proactiveEnabled : cfg.proactiveEnabled,
            proactiveSilenceMs:
              policy.proactiveSilenceMs !== undefined ? policy.proactiveSilenceMs : cfg.proactiveSilenceMs,
            notifyAdminOnHandoff: policy.notifyAdminOnHandoff !== undefined ? policy.notifyAdminOnHandoff : true,
          },
        };
      })
      .sort((a, b) => b.messageCount - a.messageCount || a.groupId - b.groupId);

    return NextResponse.json(
      ok({
        groups,
        globals: {
          proactiveEnabled: cfg.proactiveEnabled,
          proactiveSilenceMs: cfg.proactiveSilenceMs,
          // 全局无此字段,默认 true;按群可关
          notifyAdminOnHandoff: true as const,
        },
      })
    );
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
