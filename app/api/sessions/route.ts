import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
  const repo = new Repo(sharedDb(cfg.dbPath));
  return NextResponse.json(ok(repo.listSessions()));
}
