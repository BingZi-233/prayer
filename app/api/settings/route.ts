import { NextRequest, NextResponse } from "next/server";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { readSettings, writeSettingsRaw } from "@/lib/settings-writer";
import { ok, fail } from "@/lib/api";

function cfgDir(): string {
  return getConfig(new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db"))).claudeConfigDir;
}

export async function GET(): Promise<NextResponse> {
  const s = readSettings(cfgDir());
  return NextResponse.json(ok(s ? JSON.stringify(s, null, 2) : '{\n  "env": {}\n}'));
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.raw !== "string") return NextResponse.json(fail("参数非法"), { status: 400 });
  try {
    writeSettingsRaw(cfgDir(), body.raw);
    return NextResponse.json(ok(true));
  } catch {
    return NextResponse.json(fail("非法 JSON"), { status: 400 });
  }
}
