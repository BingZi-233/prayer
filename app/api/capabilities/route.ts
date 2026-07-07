import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { probeCapabilities } from "@/lib/agent/introspect";
import { ok, fail } from "@/lib/api";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const refresh = new URL(req.url).searchParams.has("refresh");
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    // cs / packyapi 及其 MCP server 由 enabledPlugins 动态发现(见 probeCapabilities),无需在此装配 in-process 工具
    const caps = await probeCapabilities(cfg, { refresh });
    return NextResponse.json(ok(caps));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(fail(`能力探测失败:${msg}`), { status: 500 });
  }
}
