import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";
import { buildGroupStatMaps } from "@/lib/reflect-stats";

// 生效群活动页:生效群 ∪ 有活动群,各群消息量/最近活动/反思游标/沉淀数
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));

    const enabled = new Set(cfg.enabledGroups);
    const { cursors, msg, sed } = buildGroupStatMaps(repo);

    const ids = new Set<number>([...enabled, ...msg.keys()]);
    const list = [...ids].map((groupId) => ({
      groupId,
      enabled: enabled.has(groupId),
      messageCount: msg.get(groupId)?.count ?? 0,
      lastTs: msg.get(groupId)?.lastTs ?? 0,
      cursor: cursors.get(groupId) ?? 0,
      sedimentedCount: sed.get(groupId) ?? 0,
    })).sort((a, b) => b.messageCount - a.messageCount);

    return NextResponse.json(ok(list));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
