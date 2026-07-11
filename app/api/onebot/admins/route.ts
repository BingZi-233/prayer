import { NextRequest, NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { collectAdmins } from "@/lib/onebot/admins";
import { loadGroupMembers, toAdminMemberShape } from "@/lib/onebot/members-fetch";
import { ok, fail } from "@/lib/api";

function repo(): Repo {
  return new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"));
}

/** 解析 ?groups=1,2,3;非法项丢弃 */
function parseGroupsParam(raw: string | null): number[] | null {
  if (raw == null || raw === "") return null;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const n = Number(part);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 拉取群内 owner/admin 名单,跨群按 QQ 去重。
 * - ?groups=1,2,3 指定群(配置页草稿用)
 * - 缺省用配置里的 enabledGroups
 * 排除 Bot QQ。
 * 成员列表走 name-cache(24h TTL,含 role);旧缓存无 role 时自动刷新一次。
 * bot 未连接或部分群拉失败时:有结果仍返回 ok,全失败 503。
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cfg = getConfig(repo());
  const fromQuery = parseGroupsParam(req.nextUrl.searchParams.get("groups"));
  const groups = (fromQuery ?? cfg.enabledGroups).filter((g) => Number.isFinite(g) && g > 0);
  if (groups.length === 0) {
    return NextResponse.json(ok([]));
  }

  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  const results = await Promise.all(
    groups.map(async (groupId) => {
      const members = await loadGroupMembers(groupId, { refresh, requireRoles: true });
      return { groupId, members };
    }),
  );

  const okGroups = results
    .filter((r): r is { groupId: number; members: NonNullable<typeof r.members> } => r.members != null)
    .map((r) => ({ groupId: r.groupId, members: toAdminMemberShape(r.members) }));

  if (okGroups.length === 0) {
    return NextResponse.json(fail("bot 未连接或无法获取群成员"), { status: 503 });
  }

  const admins = collectAdmins(okGroups, { excludeUserIds: [cfg.botQQ] });
  return NextResponse.json(ok(admins));
}
