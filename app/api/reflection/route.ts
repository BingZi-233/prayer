import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// 反思专页:节奏配置 + 每群进度(游标/滞后/缓冲/沉淀数) + 沉淀条目列表
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    const now = Date.now();

    const cursors = new Map(repo.reflectCursors().map((c) => [c.groupId, c.cursor]));
    const msg = new Map(repo.groupMessageStats().map((m) => [m.groupId, m]));
    const entries = repo.reflectionEntries();
    const sed = new Map<number, number>();
    for (const e of entries) if (e.groupId != null) sed.set(e.groupId, (sed.get(e.groupId) ?? 0) + 1);

    const ids = new Set<number>([...cfg.enabledGroups, ...cursors.keys(), ...msg.keys()]);
    const groups = [...ids].map((groupId) => {
      const cursor = cursors.get(groupId) ?? 0;
      return {
        groupId,
        cursor,
        lagMs: cursor === 0 ? null : Math.max(0, now - cfg.reflectSettleMs - cursor),
        bufferCount: msg.get(groupId)?.count ?? 0,
        sedimentedCount: sed.get(groupId) ?? 0,
      };
    }).sort((a, b) => a.groupId - b.groupId);

    return NextResponse.json(ok({
      config: {
        scanMs: cfg.reflectScanMs,
        lookbackMs: cfg.reflectLookbackMs,
        settleMs: cfg.reflectSettleMs,
        windowMax: cfg.reflectWindowMax,
      },
      groups,
      entries,
    }));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
