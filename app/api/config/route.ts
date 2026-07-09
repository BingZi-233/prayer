import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig, setConfig, type AppConfig, type GroupPolicy } from "@/lib/config-store";
import { getRuntime, defaultBuilders } from "@/lib/runtime";
import { ok, fail, maskConfig } from "@/lib/api";
import { mergeSecret } from "@/lib/settings-writer";

function repo(): Repo {
  return new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"));
}

const groupPolicySchema = z.object({
  proactiveEnabled: z.boolean().optional(),
  proactiveSilenceMs: z.number().optional(),
  notifyAdminOnHandoff: z.boolean().optional(),
});

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
  reflectCompactMs: z.number().optional(),
  reflectCompactMinEntries: z.number().optional(),
  reflectNotifyAdmin: z.boolean().optional(),
  resumeTtlMs: z.number().optional(),
  proactiveEnabled: z.boolean().optional(),
  proactiveScanMs: z.number().optional(),
  proactiveSilenceMs: z.number().optional(),
  proactiveMaxPerScan: z.number().optional(),
  supportUrl: z.string().optional(),
  ackEnabled: z.boolean().optional(),
  maxReplyChars: z.number().optional(),
  usageBudgetUsd: z.number().optional(),
  // null = 清除该群全部覆盖,回到跟随全局;object = 整份替换该群策略(非字段浅合并)
  groupPolicies: z.record(z.string(), groupPolicySchema.nullable()).optional(),
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
  const patch = { ...parsed.data } as Partial<AppConfig> & {
    groupPolicies?: Record<string, GroupPolicy | null>;
  };
  // secret 留空则保留
  if ("onebotAccessToken" in patch) {
    patch.onebotAccessToken = mergeSecret(current.onebotAccessToken, patch.onebotAccessToken ?? "");
  }
  // 按群: null 删除覆盖; object 整份替换(便于 UI「跟随全局」清字段)
  if (patch.groupPolicies) {
    const merged: Record<string, GroupPolicy> = { ...current.groupPolicies };
    for (const [k, v] of Object.entries(patch.groupPolicies)) {
      if (v === null) {
        delete merged[k];
      } else {
        // 去掉 undefined 键,避免脏字段
        const clean: GroupPolicy = {};
        if (v.proactiveEnabled !== undefined) clean.proactiveEnabled = v.proactiveEnabled;
        if (v.proactiveSilenceMs !== undefined) clean.proactiveSilenceMs = v.proactiveSilenceMs;
        if (v.notifyAdminOnHandoff !== undefined) clean.notifyAdminOnHandoff = v.notifyAdminOnHandoff;
        if (Object.keys(clean).length === 0) delete merged[k];
        else merged[k] = clean;
      }
    }
    patch.groupPolicies = merged;
  }
  const next = setConfig(r, patch as Partial<AppConfig>);

  const builders = await defaultBuilders();
  getRuntime().reconfigure(next, builders);
  return NextResponse.json(ok(maskConfig(next)));
}
