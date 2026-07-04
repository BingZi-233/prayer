import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { runIngest } from "@/scripts/ingest";
import { ok, fail } from "@/lib/api";

export async function POST(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const db = sharedDb(cfg.dbPath);
    const results = await runIngest(new Repo(db), "docs/kb");
    return NextResponse.json(ok(results));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
