# Web 插件管理器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 admin web 上安装 / 更新 / 启停 / 删除 Claude Code 插件，操作后自动 reconfigure 让 agent 生效。

**Architecture:** 后端 `lib/plugins/manager.ts` 用 `execFile` 包 `claude plugin` CLI（注入 `CLAUDE_CONFIG_DIR`），API 路由 `app/api/plugins/*` 分发操作、写操作后调 `getRuntime().reconfigure()`；砍掉 runtime 显式 `pluginPaths`，插件唯一由 `settingSources:["user"]` + `enabledPlugins` 加载。前端 `app/admin/plugins/page.tsx` 提供表格 + 添加表单。

**Tech Stack:** Next.js App Router, TypeScript, zod, vitest, shadcn/ui, `@anthropic-ai/claude-agent-sdk`（`claude` CLI on PATH）。

参考 spec：`docs/superpowers/specs/2026-07-07-web-plugin-manager-design.md`

---

## 文件结构

- Create: `lib/plugins/manager.ts` — `PluginManager` 类，包 `claude plugin` CLI
- Create: `app/api/plugins/route.ts` — GET list / POST install
- Create: `app/api/plugins/[id]/route.ts` — PATCH enable/disable/update / DELETE uninstall
- Create: `app/admin/plugins/page.tsx` — 前端页
- Modify: `lib/runtime.ts` — 删 `makeAgent` 的 `pluginPaths`
- Modify: `components/app-sidebar.tsx` — 加「插件」入口
- Test: `tests/lib/plugins/manager.test.ts`
- Test: `tests/lib/runtime.test.ts` — 已有，验证不再传 pluginPaths（无需改，makeAgent 已被 mock；仅确认绿）

---

## Task 1: PluginManager — 参数校验 + list

**Files:**
- Create: `lib/plugins/manager.ts`
- Test: `tests/lib/plugins/manager.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/lib/plugins/manager.test.ts
import { describe, it, expect, vi } from "vitest";

// mock execFile：返回可控 stdout/stderr
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...a: unknown[]) => execFileMock(...a) }));

import { PluginManager, isValidPluginRef } from "@/lib/plugins/manager";

function mgr() {
  return new PluginManager("/tmp/cfgdir-test");
}

describe("isValidPluginRef", () => {
  it("放行正常 name@marketplace", () => {
    expect(isValidPluginRef("packyapi@prayer-local")).toBe(true);
    expect(isValidPluginRef("rust-analyzer-lsp@claude-plugins-official")).toBe(true);
  });
  it("拒绝注入字符", () => {
    for (const bad of ["a; rm -rf /", "a$(whoami)", "a`id`", "a b", "a|b", "a&b", "a\nb", "a>b"]) {
      expect(isValidPluginRef(bad)).toBe(false);
    }
  });
});

describe("PluginManager.list", () => {
  it("解析 --json 并注入 CLAUDE_CONFIG_DIR", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: '[{"id":"packyapi@prayer-local","version":"0.1.0","scope":"user","enabled":true,"installPath":"x"}]', stderr: "" })
    );
    const res = await mgr().list();
    expect(res).toEqual([
      { id: "packyapi@prayer-local", version: "0.1.0", scope: "user", enabled: true, installPath: "x" },
    ]);
    // 校验命令 + 环境注入
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toEqual(["plugin", "list", "--json"]);
    expect((opts as { env: Record<string, string> }).env.CLAUDE_CONFIG_DIR).toContain("cfgdir-test");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/plugins/manager.test.ts`
Expected: FAIL — `Cannot find module '@/lib/plugins/manager'`

- [ ] **Step 3: 写最小实现**

```typescript
// lib/plugins/manager.ts
import { execFile } from "node:child_process";
import { resolve } from "node:path";

export interface PluginInfo {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
  mcpServers?: Record<string, unknown>;
}

// 插件引用 name@marketplace / 单名：仅允许安全字符，杜绝命令注入
// 注：execFile 不经 shell，本身已无注入面；此校验为纵深防御 + 早失败
export function isValidPluginRef(ref: string): boolean {
  return /^[A-Za-z0-9._@/-]+$/.test(ref) && ref.length > 0 && ref.length < 256;
}

export interface CliResult {
  ok: boolean;
  stdout?: string;
  error?: string;
}

export class PluginManager {
  constructor(private configDir: string) {}

  private run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((res, rej) => {
      execFile(
        "claude",
        args,
        { env: { ...process.env, CLAUDE_CONFIG_DIR: resolve(this.configDir) }, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) rej(new Error(stderr?.toString().trim() || err.message));
          else res({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      );
    });
  }

  async list(): Promise<PluginInfo[]> {
    const { stdout } = await this.run(["plugin", "list", "--json"]);
    return JSON.parse(stdout) as PluginInfo[];
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/plugins/manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/plugins/manager.ts tests/lib/plugins/manager.test.ts
git commit -m "feat(plugins): PluginManager 校验 + list"
```

---

## Task 2: PluginManager — install/uninstall/enable/disable/update/addMarketplace

**Files:**
- Modify: `lib/plugins/manager.ts`
- Test: `tests/lib/plugins/manager.test.ts`

- [ ] **Step 1: 写失败测试（追加到同文件）**

```typescript
describe("PluginManager 写操作", () => {
  function okExec() {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(null, { stdout: "done", stderr: "" }));
  }

  it("install 拼 <name>@<mkt> --scope user", async () => {
    okExec();
    const r = await mgr().install("packyapi", "prayer-local");
    expect(r).toEqual({ ok: true, stdout: "done" });
    expect(execFileMock.mock.calls[0][1]).toEqual(["plugin", "install", "packyapi@prayer-local", "--scope", "user"]);
  });

  it("enable/disable/update/uninstall 用 id", async () => {
    okExec();
    const m = mgr();
    await m.enable("packyapi@prayer-local");
    await m.disable("packyapi@prayer-local");
    await m.update("packyapi@prayer-local");
    await m.uninstall("packyapi@prayer-local");
    const sub = execFileMock.mock.calls.map((c) => c[1][1]);
    expect(sub).toEqual(["enable", "disable", "update", "uninstall"]);
  });

  it("addMarketplace github 传 owner/repo", async () => {
    okExec();
    await mgr().addMarketplace("owner/repo");
    expect(execFileMock.mock.calls[0][1]).toEqual(["plugin", "marketplace", "add", "owner/repo"]);
  });

  it("非法 ref 直接拒绝，不调 CLI", async () => {
    execFileMock.mockClear();
    await expect(mgr().install("a;rm", "mkt")).rejects.toThrow(/非法/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("CLI 非零退出 → ok:false + error", async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(new Error("x"), { stdout: "", stderr: "boom" }));
    const r = await mgr().enable("packyapi@prayer-local");
    expect(r).toEqual({ ok: false, error: "boom" });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/plugins/manager.test.ts`
Expected: FAIL — `mgr().install is not a function`

- [ ] **Step 3: 实现（追加到 `PluginManager` 类）**

```typescript
  private async mutate(args: string[]): Promise<CliResult> {
    try {
      const { stdout } = await this.run(args);
      return { ok: true, stdout: stdout.trim() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private assertRef(ref: string): void {
    if (!isValidPluginRef(ref)) throw new Error(`非法插件引用: ${ref}`);
  }

  install(name: string, marketplace: string): Promise<CliResult> {
    this.assertRef(name);
    this.assertRef(marketplace);
    return this.mutate(["plugin", "install", `${name}@${marketplace}`, "--scope", "user"]);
  }

  uninstall(id: string): Promise<CliResult> {
    this.assertRef(id);
    return this.mutate(["plugin", "uninstall", id, "--scope", "user"]);
  }

  enable(id: string): Promise<CliResult> {
    this.assertRef(id);
    return this.mutate(["plugin", "enable", id, "--scope", "user"]);
  }

  disable(id: string): Promise<CliResult> {
    this.assertRef(id);
    return this.mutate(["plugin", "disable", id, "--scope", "user"]);
  }

  update(id: string): Promise<CliResult> {
    this.assertRef(id);
    return this.mutate(["plugin", "update", id, "--scope", "user"]);
  }

  // github: "owner/repo"；directory: 绝对路径。两者都只允许安全字符 + 绝对路径校验
  addMarketplace(source: string): Promise<CliResult> {
    const isAbs = source.startsWith("/");
    if (!isAbs && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(source)) {
      throw new Error(`非法 marketplace 源: ${source}`);
    }
    if (isAbs && /[;&|`$\n\r><]/.test(source)) throw new Error(`非法路径: ${source}`);
    return this.mutate(["plugin", "marketplace", "add", source]);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/plugins/manager.test.ts`
Expected: PASS（全部 describe 绿）

- [ ] **Step 5: Commit**

```bash
git add lib/plugins/manager.ts tests/lib/plugins/manager.test.ts
git commit -m "feat(plugins): PluginManager 写操作 + 注入防御"
```

---

## Task 3: runtime.ts 去掉显式 pluginPaths

**Files:**
- Modify: `lib/runtime.ts`（`defaultBuilders` 内 `makeAgent`）
- Test: `tests/lib/runtime.test.ts`（已有，run 确认仍绿）

- [ ] **Step 1: 改实现**

在 `lib/runtime.ts` 的 `defaultBuilders` 里，把：

```typescript
    makeAgent: (_cfg, repo) =>
      new Agent({
        systemPrompt: "",
        makeToolServer: (ctx) => buildToolServer(repo, ctx),
        // 本仓库 local plugin 目录(源码,非 cache),绝对化后交给 SDK 显式加载
        pluginPaths: [resolve(process.cwd(), "plugins/packyapi")],
      }),
```

改成：

```typescript
    makeAgent: (_cfg, repo) =>
      new Agent({
        systemPrompt: "",
        makeToolServer: (ctx) => buildToolServer(repo, ctx),
        // 不再显式传 pluginPaths:插件唯一由 CLAUDE_CONFIG_DIR/settings.json 的
        // enabledPlugins(settingSources:["user"])加载,避免与显式 plugins 双加载/冲突。
        // web 插件管理器通过 claude plugin CLI 管理 enabledPlugins + cache。
      }),
```

同时删除文件顶部不再使用的 `import { resolve } from "path";` —— 若 `resolve` 在 `start()` 里仍用于 `process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir)`，则**保留** import（确认后再定）。

- [ ] **Step 2: 检查 resolve 是否还被用到**

Run: `grep -n "resolve(" lib/runtime.ts`
Expected: 若仅剩 `start()` 里的 `resolve(cfg.claudeConfigDir)` → 保留 import；若无 → 删 import。

- [ ] **Step 3: 跑测试**

Run: `pnpm vitest run tests/lib/runtime.test.ts`
Expected: PASS（makeAgent 被 fakeBuilders 覆盖，改动不影响单测）

- [ ] **Step 4: typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 无 `resolve` 未使用 / 未定义错误

- [ ] **Step 5: Commit**

```bash
git add lib/runtime.ts
git commit -m "refactor(runtime): 去显式 pluginPaths,插件统一走 enabledPlugins"
```

---

## Task 4: API GET list + POST install

**Files:**
- Create: `app/api/plugins/route.ts`
- Test: `tests/lib/plugins/route.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/lib/plugins/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const listMock = vi.fn();
const installMock = vi.fn();
const addMarketplaceMock = vi.fn();
const reconfigureMock = vi.fn();

vi.mock("@/lib/plugins/manager", () => ({
  PluginManager: vi.fn().mockImplementation(() => ({
    list: listMock,
    install: installMock,
    addMarketplace: addMarketplaceMock,
  })),
}));
vi.mock("@/lib/runtime", () => ({
  getRuntime: () => ({ reconfigure: reconfigureMock }),
  defaultBuilders: async () => ({}),
}));
vi.mock("@/lib/db/shared", () => ({ sharedDb: () => ({}) }));
vi.mock("@/lib/db/repo", () => ({ Repo: vi.fn() }));
vi.mock("@/lib/config-store", () => ({ getConfig: () => ({ claudeConfigDir: "/tmp/x", dbPath: ":memory:" }) }));

import { GET, POST } from "@/app/api/plugins/route";

beforeEach(() => {
  listMock.mockReset();
  installMock.mockReset();
  addMarketplaceMock.mockReset();
  reconfigureMock.mockReset();
});

describe("GET /api/plugins", () => {
  it("返回 list", async () => {
    listMock.mockResolvedValue([{ id: "a@b", version: "1", scope: "user", enabled: true, installPath: "x" }]);
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

describe("POST /api/plugins", () => {
  it("github:先 addMarketplace 再 install,成功后 reconfigure", async () => {
    addMarketplaceMock.mockResolvedValue({ ok: true });
    installMock.mockResolvedValue({ ok: true });
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({ source: "github", repoOrPath: "owner/repo", marketplaceName: "repo", pluginName: "pkg" }),
    });
    const res = await POST(req as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(addMarketplaceMock).toHaveBeenCalledWith("owner/repo");
    expect(installMock).toHaveBeenCalledWith("pkg", "repo");
    expect(reconfigureMock).toHaveBeenCalled();
  });

  it("install 失败 → 500,不 reconfigure", async () => {
    addMarketplaceMock.mockResolvedValue({ ok: true });
    installMock.mockResolvedValue({ ok: false, error: "boom" });
    const req = new Request("http://x/api/plugins", {
      method: "POST",
      body: JSON.stringify({ source: "directory", repoOrPath: "/abs/p", marketplaceName: "mkt", pluginName: "pkg" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(500);
    expect(reconfigureMock).not.toHaveBeenCalled();
  });

  it("非法 body → 400", async () => {
    const req = new Request("http://x/api/plugins", { method: "POST", body: JSON.stringify({ source: "x" }) });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/plugins/route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/plugins/route'`

- [ ] **Step 3: 实现**

```typescript
// app/api/plugins/route.ts
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
  repoOrPath: z.string().min(1), // github: owner/repo；directory: 绝对路径
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/plugins/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/plugins/route.ts tests/lib/plugins/route.test.ts
git commit -m "feat(plugins): API GET list + POST install"
```

---

## Task 5: API PATCH enable/disable/update + DELETE uninstall

**Files:**
- Create: `app/api/plugins/[id]/route.ts`
- Test: `tests/lib/plugins/id-route.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/lib/plugins/id-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const enableMock = vi.fn();
const disableMock = vi.fn();
const updateMock = vi.fn();
const uninstallMock = vi.fn();
const reconfigureMock = vi.fn();

vi.mock("@/lib/plugins/manager", () => ({
  PluginManager: vi.fn().mockImplementation(() => ({
    enable: enableMock, disable: disableMock, update: updateMock, uninstall: uninstallMock,
  })),
}));
vi.mock("@/lib/runtime", () => ({ getRuntime: () => ({ reconfigure: reconfigureMock }), defaultBuilders: async () => ({}) }));
vi.mock("@/lib/db/shared", () => ({ sharedDb: () => ({}) }));
vi.mock("@/lib/db/repo", () => ({ Repo: vi.fn() }));
vi.mock("@/lib/config-store", () => ({ getConfig: () => ({ claudeConfigDir: "/tmp/x", dbPath: ":memory:" }) }));

import { PATCH, DELETE } from "@/app/api/plugins/[id]/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { [enableMock, disableMock, updateMock, uninstallMock, reconfigureMock].forEach((m) => m.mockReset()); });

describe("PATCH /api/plugins/[id]", () => {
  it("action=enable 调 enable(id) + reconfigure", async () => {
    enableMock.mockResolvedValue({ ok: true });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ action: "enable" }) });
    const res = await PATCH(req as never, ctx("pkg@mkt") as never);
    expect((await res.json()).ok).toBe(true);
    expect(enableMock).toHaveBeenCalledWith("pkg@mkt");
    expect(reconfigureMock).toHaveBeenCalled();
  });

  it("非法 action → 400", async () => {
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ action: "boom" }) });
    const res = await PATCH(req as never, ctx("pkg@mkt") as never);
    expect(res.status).toBe(400);
  });

  it("CLI 失败 → 500,不 reconfigure", async () => {
    updateMock.mockResolvedValue({ ok: false, error: "x" });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ action: "update" }) });
    const res = await PATCH(req as never, ctx("pkg@mkt") as never);
    expect(res.status).toBe(500);
    expect(reconfigureMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/plugins/[id]", () => {
  it("uninstall + reconfigure", async () => {
    uninstallMock.mockResolvedValue({ ok: true });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }) as never, ctx("pkg@mkt") as never);
    expect((await res.json()).ok).toBe(true);
    expect(uninstallMock).toHaveBeenCalledWith("pkg@mkt");
    expect(reconfigureMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/plugins/id-route.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

```typescript
// app/api/plugins/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { getRuntime, defaultBuilders } from "@/lib/runtime";
import { PluginManager, type CliResult } from "@/lib/plugins/manager";
import { ok, fail } from "@/lib/api";

function cfg() {
  return getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
}
function manager() {
  return new PluginManager(cfg().claudeConfigDir);
}
async function applyAndReconfigure(result: CliResult): Promise<NextResponse> {
  if (!result.ok) return NextResponse.json(fail(result.error ?? "操作失败"), { status: 500 });
  const c = cfg();
  getRuntime().reconfigure(c, await defaultBuilders());
  return NextResponse.json(ok(true));
}

const patchSchema = z.object({ action: z.enum(["enable", "disable", "update"]) });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
  try {
    const m = manager();
    const r = await m[parsed.data.action](id);
    return applyAndReconfigure(r);
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const r = await manager().uninstall(id);
    return applyAndReconfigure(r);
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/plugins/id-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/plugins/[id]/route.ts" tests/lib/plugins/id-route.test.ts
git commit -m "feat(plugins): API PATCH 启停/更新 + DELETE 卸载"
```

---

## Task 6: 前端页 + 侧栏入口

**Files:**
- Create: `app/admin/plugins/page.tsx`
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: 侧栏加入口**

在 `components/app-sidebar.tsx`：
- import 处加图标：把 `Boxes` 那行改为 `..., Zap, Boxes, Puzzle } from "lucide-react";`
- `nav` 数组在 `capabilities` 后加一项：

```typescript
  { href: "/admin/plugins", label: "插件", icon: Puzzle },
```

- [ ] **Step 2: 写前端页**

```tsx
// app/admin/plugins/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Puzzle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

interface Plugin { id: string; version: string; scope: string; enabled: boolean; installPath: string; }

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ source: "github", repoOrPath: "", marketplaceName: "", pluginName: "" });

  async function load() {
    const r = await fetch("/api/plugins").then((x) => x.json());
    if (r.ok) setPlugins(r.data);
    else setErr(r.error);
  }
  useEffect(() => { load(); }, []);

  async function act(fn: () => Promise<Response>) {
    setBusy(true); setErr(null);
    try {
      const r = await fn().then((x) => x.json());
      if (!r.ok) setErr(r.error);
      await load();
    } finally { setBusy(false); }
  }

  const install = () =>
    act(() => fetch("/api/plugins", { method: "POST", body: JSON.stringify(form) }));
  const toggle = (p: Plugin) =>
    act(() => fetch(`/api/plugins/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ action: p.enabled ? "disable" : "enable" }) }));
  const update = (p: Plugin) =>
    act(() => fetch(`/api/plugins/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ action: "update" }) }));
  const remove = (p: Plugin) =>
    act(() => fetch(`/api/plugins/${encodeURIComponent(p.id)}`, { method: "DELETE" }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">插件</h1>
        <p className="text-muted-foreground text-sm">安装 / 更新 / 启停插件,操作后 agent 自动重载生效。</p>
      </div>

      {err && <div className="text-destructive text-sm">{err}</div>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="size-4" />添加插件</CardTitle>
          <CardDescription>GitHub 传 owner/repo,本地目录传绝对路径;marketplace 名与插件名见其 marketplace.json。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label>来源</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="directory">本地目录</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{form.source === "github" ? "owner/repo" : "绝对路径"}</Label>
            <Input value={form.repoOrPath} onChange={(e) => setForm({ ...form, repoOrPath: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>marketplace 名</Label>
            <Input value={form.marketplaceName} onChange={(e) => setForm({ ...form, marketplaceName: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>插件名</Label>
            <Input value={form.pluginName} onChange={(e) => setForm({ ...form, pluginName: e.target.value })} />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button onClick={install} disabled={busy || !form.repoOrPath || !form.marketplaceName || !form.pluginName}>安装</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>已装插件</CardTitle></CardHeader>
        <CardContent>
          {plugins.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Puzzle /></EmptyMedia>
                <EmptyTitle>暂无插件</EmptyTitle>
                <EmptyDescription>用上方表单安装。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead><TableHead>版本</TableHead><TableHead>scope</TableHead>
                  <TableHead>启用</TableHead><TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plugins.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.id}</TableCell>
                    <TableCell><Badge variant="secondary">{p.version}</Badge></TableCell>
                    <TableCell>{p.scope}</TableCell>
                    <TableCell><Switch checked={p.enabled} disabled={busy} onCheckedChange={() => toggle(p)} /></TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => update(p)}><RefreshCw className="size-3.5" /></Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => remove(p)}><Trash2 className="size-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: 确认所用 shadcn 组件都已存在**

Run: `ls components/ui/{card,button,input,label,switch,badge,table,select,empty}.tsx`
Expected: 全部存在。缺哪个用 `pnpm dlx shadcn@latest add <name>` 补（照 `components.json`）。

- [ ] **Step 4: 构建校验**

Run: `pnpm exec tsc --noEmit && pnpm exec next build 2>&1 | tail -20`
Expected: 无类型错误，`/admin/plugins` 路由编译通过。（build 慢可只跑 tsc）

- [ ] **Step 5: Commit**

```bash
git add app/admin/plugins/page.tsx components/app-sidebar.tsx
git commit -m "feat(plugins): admin 插件管理页 + 侧栏入口"
```

---

## Task 7: 全量测试 + 手动端到端验证

**Files:** 无（验证）

- [ ] **Step 1: 全量单测**

Run: `pnpm vitest run`
Expected: 全绿（含新增 manager / route 测试）

- [ ] **Step 2: 手动验证 CLI 支点（关键风险）**

Run:
```bash
CLAUDE_CONFIG_DIR="$(pwd)/data/claude-config" claude plugin list --json | head
```
Expected: 输出当前配置目录的插件 JSON。确认 `install`/`enable` 等在该配置目录非交互可用（可先 `disable` 再 `enable` packyapi 试）：
```bash
CLAUDE_CONFIG_DIR="$(pwd)/data/claude-config" claude plugin disable packyapi@prayer-local --scope user
CLAUDE_CONFIG_DIR="$(pwd)/data/claude-config" claude plugin enable packyapi@prayer-local --scope user
```
若任一报错「非交互不支持」或忽略 CLAUDE_CONFIG_DIR，**停下**并回报——设计支点被推翻，需改走直接改 settings.json 文件方案。

- [ ] **Step 3: 起 dev server 手验前端**

Run: `pnpm dev`（后台），浏览器开 `http://localhost:3000/admin/plugins`
Expected: 列出已装插件；切换 packyapi 启用开关 → 网络请求 200、列表刷新、`data/claude-config/settings.json` 的 `enabledPlugins` 相应变化。

- [ ] **Step 4: 验 reconfigure 生效**

改一处 `plugins/packyapi/skills/packyapi/SKILL.md`（如加一行注释），在插件页点 packyapi 的「更新」或「禁用→启用」触发 reconfigure；下条 QQ 消息（或看 `/admin` 运行状态 bootedAt 刷新）确认管线已重启。
Expected: runtime 状态 `running`、`bootedAt` 更新为最新。

- [ ] **Step 5: 最终 commit（若手验中有小修）**

```bash
git add -A
git commit -m "test(plugins): 端到端手验通过"
```

---

## Self-Review 结论

- **Spec 覆盖**：manager(§2)→Task1-2；API(§3)→Task4-5；runtime 改动(§4)→Task3；前端(§5)→Task6；测试(§6)→各 Task + Task7；风险验证(§风险)→Task7 Step2/4。全覆盖。
- **Placeholder**：无 TBD/TODO；所有代码步给出完整代码。
- **类型一致**：`PluginInfo`/`CliResult`/`PluginManager` 方法名（install/uninstall/enable/disable/update/addMarketplace/list）在 Task1-2 定义，Task4-5 引用一致；前端 `Plugin` 接口字段对齐 `PluginInfo` 子集。
- **已知待验风险**：`claude` CLI 是否非交互尊重 `CLAUDE_CONFIG_DIR`（Task7 Step2 硬验，失败则回退直接写 settings.json）；`directory` 源 `update` 可能 no-op（靠 reconfigure 就地重读，Task7 Step4 验）。
