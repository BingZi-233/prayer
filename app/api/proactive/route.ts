import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// 主动回复专页:节奏配置 + 每群(游标/滞后/主动回复数) + 最近插话列表
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    const now = Date.now();

    const counts = new Map(repo.proactiveGroupCounts().map((c) => [c.groupId, c]));
    const cursors = new Map<number, number>();
    for (const gid of cfg.enabledGroups) cursors.set(gid, repo.groupProactiveCursor(gid));

    const ids = new Set<number>([...cfg.enabledGroups, ...counts.keys()]);
    const groups = [...ids]
      .filter((gid) => gid !== cfg.adminGroupId)
      .map((groupId) => {
        const cursor = cursors.get(groupId) ?? repo.groupProactiveCursor(groupId);
        const c = counts.get(groupId);
        return {
          groupId,
          enabled: cfg.enabledGroups.includes(groupId),
          cursor,
          // 游标落后当前沉默前沿多久(与 poller 的 until = now - silenceMs 对齐)
          lagMs: cursor === 0 ? null : Math.max(0, now - cfg.proactiveSilenceMs - cursor),
          replyCount: c?.count ?? 0,
          lastReplyTs: c?.lastTs ?? null,
        };
      })
      .sort((a, b) => a.groupId - b.groupId);

    return NextResponse.json(
      ok({
        config: {
          enabled: cfg.proactiveEnabled,
          scanMs: cfg.proactiveScanMs,
          silenceMs: cfg.proactiveSilenceMs,
          maxPerScan: cfg.proactiveMaxPerScan,
        },
        total: repo.proactiveTotalCount(),
        groups,
        replies: repo.proactiveReplies(50),
      })
    );
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
