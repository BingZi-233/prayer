import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

function getRepo(): Repo {
  const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
  return new Repo(sharedDb(cfg.dbPath));
}

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
        const policy = cfg.groupPolicies[String(groupId)];
        const silence = policy?.proactiveSilenceMs ?? cfg.proactiveSilenceMs;
        const proactiveOn =
          policy?.proactiveEnabled !== undefined ? policy.proactiveEnabled : cfg.proactiveEnabled;
        return {
          groupId,
          enabled: cfg.enabledGroups.includes(groupId),
          proactiveEnabled: proactiveOn,
          cursor,
          // 游标落后当前沉默前沿多久(与 poller 的 until = now - silenceMs 对齐)
          lagMs: cursor === 0 ? null : Math.max(0, now - silence - cursor),
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

const patchSchema = z.object({
  id: z.number(),
  quality: z.enum(["ok", "bad"]),
});

// 质检:标主动回复为恰当 / 不当
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
    const okk = getRepo().setProactiveQuality(parsed.data.id, parsed.data.quality);
    if (!okk) return NextResponse.json(fail("记录不存在"), { status: 404 });
    return NextResponse.json(ok({ id: parsed.data.id, quality: parsed.data.quality }));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
