import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { buildToolServer, type ToolContext } from "@/lib/tools/index";
import { probeCapabilities } from "@/lib/agent/introspect";
import { ok, fail } from "@/lib/api";

// 探针要求 cs MCP server 与 Agent 装配一致;给最小占位 ctx(探针不真跑工具)
const PROBE_CTX: ToolContext = { sessionKey: "probe", groupId: 0, userId: 0 };

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const refresh = new URL(req.url).searchParams.has("refresh");
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    const caps = await probeCapabilities(cfg, {
      refresh,
      makeToolServer: () => buildToolServer(repo, PROBE_CTX),
    });
    return NextResponse.json(ok(caps));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(fail(`能力探测失败:${msg}`), { status: 500 });
  }
}
