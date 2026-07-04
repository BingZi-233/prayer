import { NextResponse } from "next/server";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  const cfg = getConfig(new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db")));
  const repo = new Repo(openDb(cfg.dbPath));
  return NextResponse.json(ok(repo.listSessions()));
}
