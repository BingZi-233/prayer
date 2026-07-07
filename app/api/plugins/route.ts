import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { getRuntime, defaultBuilders } from "@/lib/runtime";
import { PluginManager } from "@/lib/plugins/manager";
import { ok, fail } from "@/lib/api";

function cfg() {
  return getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
}
function manager() {
  return new PluginManager(cfg().claudeConfigDir);
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(ok(await manager().list()));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}

const postSchema = z.object({
  source: z.enum(["github", "directory"]),
  repoOrPath: z.string().min(1),
  marketplaceName: z.string().min(1),
  pluginName: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
  const { repoOrPath, marketplaceName, pluginName } = parsed.data;

  try {
    const m = manager();
    const added = await m.addMarketplace(repoOrPath);
    if (!added.ok) return NextResponse.json(fail(added.error ?? "添加 marketplace 失败"), { status: 500 });
    const installed = await m.install(pluginName, marketplaceName);
    if (!installed.ok) return NextResponse.json(fail(installed.error ?? "安装失败"), { status: 500 });

    const c = cfg();
    getRuntime().reconfigure(c, await defaultBuilders());
    return NextResponse.json(ok(await m.list()));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
