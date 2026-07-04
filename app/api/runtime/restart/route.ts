import { NextResponse } from "next/server";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { getRuntime, defaultBuilders } from "@/lib/runtime";
import { ok } from "@/lib/api";

export async function POST(): Promise<NextResponse> {
  const cfg = getConfig(new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db")));
  const builders = await defaultBuilders();
  getRuntime().reconfigure(cfg, builders);
  return NextResponse.json(ok(getRuntime().getStatus()));
}
