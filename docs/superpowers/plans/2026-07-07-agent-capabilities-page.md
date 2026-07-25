# Agent 能力页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理后台新增 `/admin/capabilities` 页,只读展示 Agent 运行时持有的 plugins / skills / MCP(含工具)/ 工具门控白名单,数据经 Claude Agent SDK 控制通道上报。

**Architecture:** 三层复用现有 overview/status 模式:内省模块 `lib/agent/introspect.ts` 启一个与 Agent 同选项的短命探针 `query()`,并发调 `reloadPlugins`/`reloadSkills`/`mcpServerStatus` 三个控制方法(零 token),取完 abort,再叠加静态工具门控层;API `app/api/capabilities/route.ts` 包装 `ok`/`fail`;client 页面 `app/admin/capabilities/page.tsx` 四分区 Card 渲染;侧栏加入口。

**Tech Stack:** Next.js 16 (App Router)、React 19、`@anthropic-ai/claude-agent-sdk`、shadcn/ui、vitest。

---

## File Structure

- **Create** `lib/agent/introspect.ts` — 探针 + 归一化 + 静态门控叠加 + 进程级缓存。核心导出 `probeCapabilities`、`Capabilities` 及子类型。
- **Create** `tests/lib/agent/introspect.test.ts` — 注入 fake `queryFn` 测归一化 / 门控叠加 / abort / 降级 / 缓存。
- **Create** `app/api/capabilities/route.ts` — `GET`,读 cfg → `probeCapabilities` → `ok`/`fail`,`?refresh` 透传,`probedAt` 在此戳。
- **Create** `app/admin/capabilities/page.tsx` — client 组件,四分区 + 刷新按钮 + loading/error。
- **Modify** `components/app-sidebar.tsx` — `nav` 数组加「能力」入口。

类型契约(全程一致):`probeCapabilities(cfg: AppConfig, opts?: ProbeOptions): Promise<Capabilities>`。

---

## Task 1: 内省模块类型 + 静态工具门控

**Files:**
- Create: `lib/agent/introspect.ts`
- Test: `tests/lib/agent/introspect.test.ts`

- [ ] **Step 1: 写失败测试(静态门控)**

`tests/lib/agent/introspect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildToolPolicy } from "@/lib/agent/introspect";

describe("buildToolPolicy", () => {
  it("allowlist 含 kb_search / WebSearch / Skill,gated 含 Bash/Read/WebFetch", () => {
    const p = buildToolPolicy();
    expect(p.allowlist).toContain("mcp__cs__kb_search");
    expect(p.allowlist).toContain("WebSearch");
    expect(p.allowlist).toContain("Skill");
    const tools = p.gated.map((g) => g.tool);
    expect(tools).toEqual(["Bash", "Read", "WebFetch"]);
    for (const g of p.gated) expect(g.constraint.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/agent/introspect.test.ts -t buildToolPolicy`
Expected: FAIL —「does not provide an export named 'buildToolPolicy'」

- [ ] **Step 3: 写类型 + buildToolPolicy**

`lib/agent/introspect.ts`:

```ts
import { TOOL_ALLOWLIST } from "./agent";

export interface CapabilityTool {
  name: string;
  description?: string;
  readOnly?: boolean;
}
export interface CapabilityMcpServer {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  version?: string;
  error?: string;
  scope?: string;
  tools: CapabilityTool[];
}
export interface CapabilitySkill {
  name: string;
  description: string;
  argumentHint?: string;
}
export interface CapabilityPlugin {
  name: string;
  path: string;
  source?: string;
}
export interface CapabilityToolPolicy {
  allowlist: string[];
  gated: { tool: string; constraint: string }[];
}
export interface Capabilities {
  plugins: CapabilityPlugin[];
  skills: CapabilitySkill[];
  mcpServers: CapabilityMcpServer[];
  toolPolicy: CapabilityToolPolicy;
  probedAt: number;
}

// 静态工具门控:与 lib/agent/agent.ts 的 isToolAllowed/denyMessage 语义一致。
// SDK 不上报本 host 的白名单,故在此静态描述。
export function buildToolPolicy(): CapabilityToolPolicy {
  return {
    allowlist: [...TOOL_ALLOWLIST],
    gated: [
      { tool: "Bash", constraint: "仅放行 PackyAPI 查询脚本(node …/packy.ts),禁 shell 链接/重定向" },
      { tool: "Read", constraint: "仅读 packyapi 技能的 references/*.md" },
      { tool: "WebFetch", constraint: "仅访问 packyapi.ai 及其子域" },
    ],
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/agent/introspect.test.ts -t buildToolPolicy`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/agent/introspect.ts tests/lib/agent/introspect.test.ts
git commit -m "feat(capabilities): 内省类型 + 静态工具门控"
```

---

## Task 2: 探针归一化 `probeCapabilities`

**Files:**
- Modify: `lib/agent/introspect.ts`
- Test: `tests/lib/agent/introspect.test.ts`

- [ ] **Step 1: 写失败测试(归一化 + abort + 降级)**

追加到 `tests/lib/agent/introspect.test.ts`:

```ts
import { probeCapabilities, type ProbeOptions } from "@/lib/agent/introspect";
import type { AppConfig } from "@/lib/config-store";

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "",
  botQQ: 1,
  adminGroupId: 2,
  enabledGroups: [],
  proactiveEnabled: false,
  proactiveScanMs: 60000,
  proactiveSilenceMs: 180000,
  proactiveMaxPerScan: 2,
  handoffTimeoutMin: 30,
  dbPath: ":memory:",
  claudeConfigDir: "/tmp/cfgdir-test",
  reflectScanMs: 300000,
  reflectLookbackMs: 7200000,
  reflectSettleMs: 600000,
  reflectWindowMax: 60,
};

// 构造带控制方法的 fake Query(async generator + 控制方法)
function fakeQuery(over: Record<string, unknown> = {}) {
  const gen = (async function* () {
    /* 探针不产出消息 */
  })();
  return Object.assign(gen, {
    reloadPlugins: async () => ({
      plugins: [{ name: "packyapi", path: "/abs/plugins/packyapi", source: "local" }],
      mcpServers: [],
      agents: [],
      commands: [],
      error_count: 0,
    }),
    reloadSkills: async () => ({
      skills: [{ name: "packyapi", description: "查价", argumentHint: "" }],
    }),
    mcpServerStatus: async () => [
      {
        name: "cs",
        status: "connected",
        serverInfo: { name: "cs", version: "1.0.0" },
        tools: [{ name: "kb_search", description: "检索知识库", annotations: { readOnly: true } }],
      },
    ],
    interrupt: async () => {},
    ...over,
  });
}

function opts(over: Partial<ProbeOptions> = {}): ProbeOptions {
  const captured: { options?: any } = {};
  return {
    queryFn: ((params: any) => {
      captured.options = params.options;
      (opts as any)._captured = captured;
      return fakeQuery();
    }) as any,
    makeToolServer: () => ({}),
    refresh: true,
    now: () => 1000,
    ...over,
  };
}

describe("probeCapabilities", () => {
  it("归一化 plugins/skills/mcp + 叠加门控", async () => {
    const caps = await probeCapabilities(cfg, opts());
    expect(caps.plugins[0]).toMatchObject({ name: "packyapi", path: "/abs/plugins/packyapi", source: "local" });
    expect(caps.skills[0]).toMatchObject({ name: "packyapi", description: "查价" });
    expect(caps.mcpServers[0]).toMatchObject({ name: "cs", status: "connected", version: "1.0.0" });
    expect(caps.mcpServers[0].tools[0]).toMatchObject({ name: "kb_search", readOnly: true });
    expect(caps.toolPolicy.allowlist).toContain("Skill");
    expect(caps.probedAt).toBe(1000);
  });

  it("探针结束后 abort 被触发", async () => {
    await probeCapabilities(cfg, opts());
    const captured = (opts as any)._captured;
    expect(captured.options.abortController.signal.aborted).toBe(true);
  });

  it("单控制方法 rejected → 该区空,其余保留", async () => {
    const caps = await probeCapabilities(
      cfg,
      opts({
        queryFn: (() => fakeQuery({ reloadSkills: async () => { throw new Error("boom"); } })) as any,
      })
    );
    expect(caps.skills).toEqual([]);
    expect(caps.plugins.length).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/agent/introspect.test.ts -t probeCapabilities`
Expected: FAIL —「does not provide an export named 'probeCapabilities'」

- [ ] **Step 3: 实现 probeCapabilities**

追加到 `lib/agent/introspect.ts`(顶部 import 增补):

```ts
import { resolve } from "path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AppConfig } from "../config-store";
import { sdkEnv } from "./agent";

// 与 lib/runtime.ts 默认 pluginPaths 保持一致
function defaultPluginPaths(): string[] {
  return [resolve(process.cwd(), "plugins/packyapi")];
}

export interface ProbeOptions {
  queryFn?: typeof sdkQuery;
  makeToolServer?: () => unknown;
  pluginPaths?: string[];
  refresh?: boolean;
  now?: () => number;
}

type McpStatusRaw = {
  name: string;
  status: CapabilityMcpServer["status"];
  serverInfo?: { name: string; version: string };
  error?: string;
  scope?: string;
  tools?: { name: string; description?: string; annotations?: { readOnly?: boolean } }[];
};

function normalizeMcp(list: McpStatusRaw[]): CapabilityMcpServer[] {
  return list.map((s) => ({
    name: s.name,
    status: s.status,
    version: s.serverInfo?.version,
    error: s.error,
    scope: s.scope,
    tools: (s.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      readOnly: t.annotations?.readOnly,
    })),
  }));
}

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function probeCapabilities(cfg: AppConfig, opts: ProbeOptions = {}): Promise<Capabilities> {
  const now = opts.now ?? Date.now;
  const queryFn = opts.queryFn ?? sdkQuery;
  const pluginPaths = opts.pluginPaths ?? defaultPluginPaths();

  // 绝对化配置目录,防 cwd 漂移(与 runtime.start 一致)
  process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir);

  const abortController = new AbortController();
  const toolServer = opts.makeToolServer ? opts.makeToolServer() : {};

  const q = queryFn({
    prompt: "probe",
    options: {
      mcpServers: { cs: toolServer as any },
      plugins: pluginPaths.map((p) => ({ type: "local" as const, path: p, skipMcpDiscovery: true })),
      settingSources: ["user"],
      permissionMode: "default",
      maxTurns: 1,
      abortController,
      env: sdkEnv(),
    } as any,
  }) as any;

  // 防御性 drain:确保 transport 被读取,控制响应能落地
  const drain = (async () => {
    try {
      for await (const _ of q as AsyncIterable<unknown>) void _;
    } catch {
      /* abort 会中断迭代,忽略 */
    }
  })();

  try {
    const [plugins, skills, mcp] = await Promise.all([
      settled(q.reloadPlugins(), { plugins: [] as CapabilityPlugin[] }),
      settled(q.reloadSkills(), { skills: [] as CapabilitySkill[] }),
      settled(q.mcpServerStatus() as Promise<McpStatusRaw[]>, [] as McpStatusRaw[]),
    ]);
    return {
      plugins: (plugins.plugins ?? []).map((p: CapabilityPlugin) => ({ name: p.name, path: p.path, source: p.source })),
      skills: (skills.skills ?? []).map((s: any) => ({
        name: s.name,
        description: s.description,
        argumentHint: s.argumentHint || undefined,
      })),
      mcpServers: normalizeMcp(mcp),
      toolPolicy: buildToolPolicy(),
      probedAt: now(),
    };
  } finally {
    abortController.abort();
    await drain.catch(() => {});
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/agent/introspect.test.ts -t probeCapabilities`
Expected: PASS(3 个用例)

- [ ] **Step 5: 提交**

```bash
git add lib/agent/introspect.ts tests/lib/agent/introspect.test.ts
git commit -m "feat(capabilities): 探针归一化 probeCapabilities"
```

---

## Task 3: 进程级缓存 + TTL

**Files:**
- Modify: `lib/agent/introspect.ts`
- Test: `tests/lib/agent/introspect.test.ts`

- [ ] **Step 1: 写失败测试(缓存命中 / refresh 绕过 / TTL 过期)**

追加到 `tests/lib/agent/introspect.test.ts`:

```ts
describe("probeCapabilities 缓存", () => {
  it("TTL 内二次调用不重启 query;refresh=true 绕过;TTL 过期重探", async () => {
    let calls = 0;
    let t = 1000;
    const mk = (refresh: boolean): ProbeOptions => ({
      queryFn: (() => { calls++; return fakeQuery(); }) as any,
      makeToolServer: () => ({}),
      refresh,
      now: () => t,
    });
    await probeCapabilities(cfg, mk(false)); // 首探
    expect(calls).toBe(1);
    await probeCapabilities(cfg, mk(false)); // TTL 内命中缓存
    expect(calls).toBe(1);
    await probeCapabilities(cfg, mk(true)); // refresh 绕过
    expect(calls).toBe(2);
    t += 61_000; // 超 TTL
    await probeCapabilities(cfg, mk(false));
    expect(calls).toBe(3);
  });
});
```

注:缓存为进程级(globalThis),该用例须在其它探针用例后运行或独立文件;若同文件干扰,给前面 `probeCapabilities` 用例统一 `refresh:true`(已在 `opts()` 默认设 `refresh:true`,天然绕过缓存,不污染此用例的 `calls` 计数)。此用例用独立局部 `calls`,互不影响。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/agent/introspect.test.ts -t 缓存`
Expected: FAIL(`calls` 断言不符,因尚无缓存,每次都 +1)

- [ ] **Step 3: 加缓存层**

改 `lib/agent/introspect.ts`:把 Task 2 的 `probeCapabilities` 主体抽为 `probeUncached`,新 `probeCapabilities` 包一层缓存。

```ts
const CACHE_TTL_MS = 60_000;
const g = globalThis as unknown as { __capCache?: { at: number; data: Capabilities } };

// 将 Task 2 的实现函数体整体重命名为 probeUncached(签名不变)
async function probeUncached(cfg: AppConfig, opts: ProbeOptions = {}): Promise<Capabilities> {
  /* …Task 2 的完整实现… */
}

export async function probeCapabilities(cfg: AppConfig, opts: ProbeOptions = {}): Promise<Capabilities> {
  const now = opts.now ?? Date.now;
  if (!opts.refresh && g.__capCache && now() - g.__capCache.at < CACHE_TTL_MS) {
    return g.__capCache.data;
  }
  const data = await probeUncached(cfg, opts);
  g.__capCache = { at: now(), data };
  return data;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/agent/introspect.test.ts`
Expected: PASS(全文件绿)

- [ ] **Step 5: 提交**

```bash
git add lib/agent/introspect.ts tests/lib/agent/introspect.test.ts
git commit -m "feat(capabilities): 探针结果进程级缓存 + TTL"
```

---

## Task 4: API 路由 `/api/capabilities`

**Files:**
- Create: `app/api/capabilities/route.ts`

- [ ] **Step 1: 写路由**

`app/api/capabilities/route.ts`:

```ts
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
```

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: 无错误(新文件类型正确)

- [ ] **Step 3: 冒烟(需本地 dev 起 + 已配 CLAUDE_CONFIG_DIR)**

Run: `pnpm dev` 后另开终端 `curl -s localhost:3000/api/capabilities | head -c 400`
Expected: `{"ok":true,"data":{"plugins":[...],"skills":[...],"mcpServers":[{"name":"cs",...}],"toolPolicy":{...},"probedAt":...}}`;若 Agent 未配则 `{"ok":false,"error":"能力探测失败:…"}`(亦可接受,页面会显错误卡)。

- [ ] **Step 4: 提交**

```bash
git add app/api/capabilities/route.ts
git commit -m "feat(capabilities): GET /api/capabilities 探测路由"
```

---

## Task 5: 页面 `/admin/capabilities`

**Files:**
- Create: `app/admin/capabilities/page.tsx`

- [ ] **Step 1: 写页面**

`app/admin/capabilities/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Boxes, Puzzle, Plug, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

interface Tool { name: string; description?: string; readOnly?: boolean }
interface McpServer { name: string; status: string; version?: string; error?: string; scope?: string; tools: Tool[] }
interface Skill { name: string; description: string; argumentHint?: string }
interface Plugin { name: string; path: string; source?: string }
interface ToolPolicy { allowlist: string[]; gated: { tool: string; constraint: string }[] }
interface Capabilities {
  plugins: Plugin[]; skills: Skill[]; mcpServers: McpServer[]; toolPolicy: ToolPolicy; probedAt: number;
}

function mcpVariant(s: string): "default" | "secondary" | "destructive" {
  if (s === "connected") return "default";
  if (s === "failed") return "destructive";
  return "secondary";
}

export default function CapabilitiesPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(refresh = false) {
    setBusy(true);
    try {
      const r = await fetch(`/api/capabilities${refresh ? "?refresh=1" : ""}`).then((x) => x.json());
      if (r.ok) { setCaps(r.data); setErr(null); }
      else { setErr(r.error); if (refresh) toast.error(r.error); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">能力</h1>
          <p className="text-muted-foreground text-sm">Agent 运行时持有的插件、技能、MCP server 与工具门控(经 SDK 上报)。</p>
        </div>
        <Button onClick={() => load(true)} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
          刷新
        </Button>
      </div>

      {err && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2 text-base">
              <TriangleAlert className="size-4" /> 探测失败
            </CardTitle>
            <CardDescription>Agent 未配置或 Claude CLI 不可用,请检查配置后重试。</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted text-muted-foreground overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{err}</pre>
          </CardContent>
        </Card>
      )}

      {!caps && !err && <Skeleton className="h-40 w-full" />}

      {caps && (
        <div className="grid gap-6">
          {/* 插件 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Puzzle className="size-4" /> 插件</CardTitle>
              <CardDescription>本地加载的 plugin(skills/commands)。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {caps.plugins.length === 0 ? <span className="text-muted-foreground text-sm">无</span> :
                caps.plugins.map((p) => (
                  <div key={p.name} className="flex flex-col gap-1 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.source && <Badge variant="secondary">{p.source}</Badge>}
                    </div>
                    <code className="text-muted-foreground text-xs break-all">{p.path}</code>
                  </div>
                ))}
            </CardContent>
          </Card>

          {/* 技能 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Boxes className="size-4" /> 技能</CardTitle>
              <CardDescription>Agent 可自动触发的 skill。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {caps.skills.length === 0 ? <span className="text-muted-foreground text-sm">无</span> :
                caps.skills.map((s) => (
                  <div key={s.name} className="flex flex-col gap-1 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      {s.argumentHint && <Badge variant="outline">{s.argumentHint}</Badge>}
                    </div>
                    <span className="text-muted-foreground text-sm">{s.description}</span>
                  </div>
                ))}
            </CardContent>
          </Card>

          {/* MCP */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Plug className="size-4" /> MCP Server</CardTitle>
              <CardDescription>已注册的 MCP server 及其工具。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {caps.mcpServers.length === 0 ? <span className="text-muted-foreground text-sm">无</span> :
                caps.mcpServers.map((m) => (
                  <div key={m.name} className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      <Badge variant={mcpVariant(m.status)}>{m.status}</Badge>
                      {m.version && <span className="text-muted-foreground text-xs">v{m.version}</span>}
                    </div>
                    {m.error && <span className="text-destructive text-xs">{m.error}</span>}
                    {m.tools.length > 0 && (
                      <ul className="flex flex-col gap-1 pl-1">
                        {m.tools.map((t) => (
                          <li key={t.name} className="text-sm">
                            <code className="text-xs">{t.name}</code>
                            {t.readOnly && <Badge variant="outline" className="ml-2">只读</Badge>}
                            {t.description && <span className="text-muted-foreground ml-2">{t.description}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
            </CardContent>
          </Card>

          {/* 工具门控 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" /> 工具门控</CardTitle>
              <CardDescription>本 host 对工具调用的白名单与限制。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">无条件放行</span>
                <div className="flex flex-wrap gap-2">
                  {caps.toolPolicy.allowlist.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">受限工具</span>
                {caps.toolPolicy.gated.map((g) => (
                  <div key={g.tool} className="text-sm">
                    <code className="text-xs">{g.tool}</code>
                    <span className="text-muted-foreground ml-2">{g.constraint}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 无错误

- [ ] **Step 3: 冒烟(dev 起后浏览器看)**

访问 `http://localhost:3000/admin/capabilities`
Expected: 四分区渲染;点「刷新」触发 `?refresh=1` 重探;Agent 未配时显红色错误卡。

- [ ] **Step 4: 提交**

```bash
git add app/admin/capabilities/page.tsx
git commit -m "feat(capabilities): 能力页四分区展示"
```

---

## Task 6: 侧栏入口

**Files:**
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: 加入口**

改 `components/app-sidebar.tsx`:import 增 `Boxes`,`nav` 数组在「运行日志」前插入一项。

import 行(把 `Boxes` 加进现有 lucide import):

```tsx
import { Activity, Settings, BookOpen, MessagesSquare, ScrollText, Bot, Brain, Ticket, Users, Zap, Boxes } from "lucide-react";
```

`nav` 数组新增(放「生效群」之后、「运行日志」之前):

```tsx
  { href: "/admin/capabilities", label: "能力", icon: Boxes },
```

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 冒烟**

刷新后台任意页,侧栏见「能力」入口,点击跳 `/admin/capabilities` 且高亮。

- [ ] **Step 4: 提交**

```bash
git add components/app-sidebar.tsx
git commit -m "feat(capabilities): 侧栏加能力入口"
```

---

## Task 7: 全量验证

- [ ] **Step 1: 全测 + 类型 + lint**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: 全绿

- [ ] **Step 2: 端到端冒烟**

`pnpm dev` → 访问 `/admin/capabilities` → 确认 plugins(packyapi + 绝对路径)、skills(packyapi)、mcp(cs + kb_search 只读)、工具门控四区正确;刷新按钮工作。

- [ ] **Step 3: 收尾提交(若冒烟发现小修)**

```bash
git add -A && git commit -m "chore(capabilities): 验证收尾"
```

---

## Self-Review 记录

- **Spec 覆盖**:plugins(Task2/5)、skills(Task2/5)、mcp+tools(Task2/5)、工具门控(Task1/5)、缓存(Task3)、API(Task4)、侧栏(Task6)、探针 abort/降级(Task2)、绝对路径(Task2 归一 + Task5 渲染 `break-all`)、独立短命探针(Task2)—— 全覆盖。
- **Placeholder**:无 TBD/TODO;每代码步含完整代码。Task3 Step3 `probeUncached` 主体注明「Task 2 的完整实现」——因是同函数体重命名,非新代码,可接受;执行者直接把 Task2 函数改名即可。
- **类型一致**:`Capabilities`/`ProbeOptions`/`CapabilityMcpServer` 等全程同名;`probeCapabilities` 签名 Task2/3/4 一致;`buildToolPolicy` Task1 定义、Task2 复用。
- **风险**:探针控制方法是否需 drain generator 才 resolve —— Task2 已内置防御性 drain;若冒烟(Task4 Step3)发现控制方法挂起,则确认 drain 生效(已实现)。
