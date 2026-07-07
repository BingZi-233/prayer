import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig, setConfig, type AppConfig } from "@/lib/config-store";
import { getRuntime, defaultBuilders } from "@/lib/runtime";
import { ok, fail, maskConfig } from "@/lib/api";
import { mergeSecret, maskSecret, readSettings, writeSettings } from "@/lib/settings-writer";

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
  model: z.string().optional(),
  enabledGroups: z.array(z.number()).optional(),
  reflectScanMs: z.number().optional(),
  reflectLookbackMs: z.number().optional(),
  reflectSettleMs: z.number().optional(),
  reflectWindowMax: z.number().optional(),
  proactiveEnabled: z.boolean().optional(),
  proactiveScanMs: z.number().optional(),
  proactiveSilenceMs: z.number().optional(),
  proactiveMaxPerScan: z.number().optional(),
  // SDK 凭证:落 CLAUDE_CONFIG_DIR/settings.json 的 env 块,不入 AppConfig
  sdkBaseUrl: z.string().optional(),
  sdkAuthToken: z.string().optional(),
});

/** 读 settings.json env 块的 SDK 配置(模型 + 中转凭证),token 掩码 */
function readSdkCreds(configDir: string): { model: string; sdkBaseUrl: string; sdkAuthToken: string } {
  const env = readSettings(configDir)?.env ?? {};
  return {
    model: env.ANTHROPIC_MODEL ?? "",
    sdkBaseUrl: env.ANTHROPIC_BASE_URL ?? "",
    sdkAuthToken: maskSecret(env.ANTHROPIC_AUTH_TOKEN ?? ""),
  };
}

export async function GET(): Promise<NextResponse> {
  const cfg = getConfig(repo());
  return NextResponse.json(ok({ ...maskConfig(cfg), ...readSdkCreds(cfg.claudeConfigDir) }));
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });

  const r = repo();
  const current = getConfig(r);
  // model 与中转凭证不入 AppConfig,统一落 settings.json 的 env 块
  const { sdkBaseUrl, sdkAuthToken, model, ...rest } = parsed.data;
  const patch = { ...rest } as Partial<AppConfig>;
  // secret 留空则保留
  if ("onebotAccessToken" in patch) {
    patch.onebotAccessToken = mergeSecret(current.onebotAccessToken, patch.onebotAccessToken ?? "");
  }
  const next = setConfig(r, patch);

  // 模型 + SDK 凭证写 settings.json env 块(保留其余键;token 掩码/留空则保留旧值)
  if (sdkBaseUrl !== undefined || sdkAuthToken !== undefined || model !== undefined) {
    const settings = readSettings(next.claudeConfigDir) ?? {};
    const env = { ...(settings.env ?? {}) };
    // 模型:非空写入,清空则删键 → SDK 回落其内置默认
    if (model !== undefined) {
      if (model) env.ANTHROPIC_MODEL = model;
      else delete env.ANTHROPIC_MODEL;
    }
    if (sdkBaseUrl !== undefined) env.ANTHROPIC_BASE_URL = sdkBaseUrl;
    if (sdkAuthToken !== undefined) {
      env.ANTHROPIC_AUTH_TOKEN = mergeSecret(env.ANTHROPIC_AUTH_TOKEN ?? "", sdkAuthToken);
    }
    writeSettings(next.claudeConfigDir, { ...settings, env });
  }

  const builders = await defaultBuilders();
  getRuntime().reconfigure(next, builders);
  return NextResponse.json(ok({ ...maskConfig(next), ...readSdkCreds(next.claudeConfigDir) }));
}
