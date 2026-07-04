import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// 工单专页:全量工单(含 closed)
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    return NextResponse.json(ok(repo.listTickets()));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
