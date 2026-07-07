import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig, setConfig, type AppConfig } from "@/lib/config-store";
import { getRuntime, defaultBuilders } from "@/lib/runtime";
import { ok, fail, maskConfig } from "@/lib/api";
import { mergeSecret } from "@/lib/settings-writer";

function repo(): Repo {
  return new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"));
}

const patchSchema = z.object({
  onebotWsUrl: z.string().optional(),
  onebotAccessToken: z.string().optional(),
  botQQ: z.number().optional(),
  adminGroupId: z.number().optional(),
  handoffTimeoutMin: z.number().optional(),
  dbPath: z.string().optional(),
  claudeConfigDir: z.string().optional(),
  enabledGroups: z.array(z.number()).optional(),
  reflectScanMs: z.number().optional(),
  reflectLookbackMs: z.number().optional(),
  reflectSettleMs: z.number().optional(),
  reflectWindowMax: z.number().optional(),
  proactiveEnabled: z.boolean().optional(),
  proactiveScanMs: z.number().optional(),
  proactiveSilenceMs: z.number().optional(),
  proactiveMaxPerScan: z.number().optional(),
});

export async function GET(): Promise<NextResponse> {
  const cfg = getConfig(repo());
  return NextResponse.json(ok(maskConfig(cfg)));
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });

  const r = repo();
  const current = getConfig(r);
  // 模型 / 中转凭证不由本程序管理:全部在 CLAUDE_CONFIG_DIR/settings.json 由用户直接维护
  const patch = { ...parsed.data } as Partial<AppConfig>;
  // secret 留空则保留
  if ("onebotAccessToken" in patch) {
    patch.onebotAccessToken = mergeSecret(current.onebotAccessToken, patch.onebotAccessToken ?? "");
  }
  const next = setConfig(r, patch);

  const builders = await defaultBuilders();
  getRuntime().reconfigure(next, builders);
  return NextResponse.json(ok(maskConfig(next)));
}
