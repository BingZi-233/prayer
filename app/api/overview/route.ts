import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// status 页汇总卡:生效群数 + 沉淀知识总数
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    return NextResponse.json(ok({
      enabledGroups: cfg.enabledGroups.length,
      reflectionCount: repo.reflectionEntries().length,
    }));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
