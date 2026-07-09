import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";
import { buildGroupStatMaps } from "@/lib/reflect-stats";

function getRepo(): Repo {
  const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
  return new Repo(sharedDb(cfg.dbPath));
}

// 反思专页:节奏配置 + 每群进度(游标/滞后/缓冲/沉淀数) + 沉淀条目列表
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    const now = Date.now();

    const { cursors, msg, sed, entries } = buildGroupStatMaps(repo);

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
        compactMs: cfg.reflectCompactMs,
        compactMinEntries: cfg.reflectCompactMinEntries,
      },
      groups,
      entries,
      compactions: repo.recentCompactions(30),
    }));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}

const patchSchema = z.object({
  id: z.number(),
  action: z.enum(["approve", "reject", "promote"]),
});

// 审核 / 驳回 / 升格为正式 FAQ 文档
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
    const r = getRepo();
    const { id, action } = parsed.data;

    if (action === "approve") {
      r.setReflectionStatus(id, "approved");
      return NextResponse.json(ok({ id, status: "approved" }));
    }
    if (action === "reject") {
      r.setReflectionStatus(id, "rejected");
      return NextResponse.json(ok({ id, status: "rejected" }));
    }

    // promote: 写到 docs/kb/promoted/ 并标 approved
    const promo = r.promoteReflection(id);
    if (!promo.ok || !promo.content) return NextResponse.json(fail("条目不存在"), { status: 404 });
    const dir = join(process.cwd(), "docs/kb/promoted");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `reflection-${id}.md`);
    const bodyMd = `# 升格反思 #${id}\n\n${promo.content}\n`;
    await writeFile(file, bodyMd, "utf8");
    return NextResponse.json(ok({ id, status: "approved", file: `promoted/reflection-${id}.md` }));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
