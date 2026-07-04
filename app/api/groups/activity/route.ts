import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// 生效群活动页:生效群 ∪ 有活动群,各群消息量/最近活动/反思游标/沉淀数
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));

    const enabled = new Set(cfg.enabledGroups);
    const cursors = new Map(repo.reflectCursors().map((c) => [c.groupId, c.cursor]));
    const msg = new Map(repo.groupMessageStats().map((m) => [m.groupId, m]));
    const sed = new Map<number, number>();
    for (const e of repo.reflectionEntries()) if (e.groupId != null) sed.set(e.groupId, (sed.get(e.groupId) ?? 0) + 1);

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
