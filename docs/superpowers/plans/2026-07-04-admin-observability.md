# 后台运行状态可观测性补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理后台完整反映运行时状态 —— 补齐 status 页,新增反思/工单/生效群三专页,会话页加转人工态。

**Architecture:** 沿用现有 `"use client"` 页 + 3s 轮询 + `/api/*`(`ok/fail` 信封)+ shadcn。DB 汇总走 `sharedDb(cfg.dbPath)` + `Repo`,新增 5 个只读 repo 方法(带单测)+ 4 个新/扩展 API + 3 新页 + 2 改页 + 导航。

**Tech Stack:** Next.js 16(App Router)、better-sqlite3、Repo 层、shadcn/ui、vitest。

**约定(所有新 API 路由复用现有获取链):**
```ts
const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
const repo = new Repo(sharedDb(cfg.dbPath));
```
错误处理:`try/catch` + `NextResponse.json(fail(...), { status: 500 })`,与 `/api/kb/vec` 一致。

---

## Task 1: Repo — listSessions 增补 humanSince/lastQuestion

**Files:**
- Modify: `lib/db/repo.ts:239-254`(现 listSessions)
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**(追加到 `describe("Repo sessions")` 内)

```ts
it("listSessions 返回 humanSince/lastQuestion", () => {
  repo.setSessionId("g:u", "sid-1");
  db.prepare("UPDATE sessions SET human_mode=1, human_since=1700, last_question='退款吗' WHERE key='g:u'").run();
  const s = repo.listSessions()[0];
  expect(s.humanMode).toBe(true);
  expect(s.humanSince).toBe(1700);
  expect(s.lastQuestion).toBe("退款吗");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: FAIL(`humanSince` undefined)

- [ ] **Step 3: 改 listSessions**(替换现有方法体)

```ts
listSessions(): {
  key: string; sessionId: string | null; humanMode: boolean;
  humanSince: number | null; lastQuestion: string | null; updatedAt: number;
}[] {
  const rows = this.db
    .prepare("SELECT key, session_id, human_mode, human_since, last_question, updated_at FROM sessions ORDER BY updated_at DESC")
    .all() as {
      key: string; session_id: string | null; human_mode: number;
      human_since: number | null; last_question: string | null; updated_at: number;
    }[];
  return rows.map((r) => ({
    key: r.key,
    sessionId: r.session_id,
    humanMode: !!r.human_mode,
    humanSince: r.human_since,
    lastQuestion: r.last_question,
    updatedAt: r.updated_at,
  }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(repo): listSessions 增补 humanSince/lastQuestion"
```

---

## Task 2: Repo — listTickets 全量工单

**Files:**
- Modify: `lib/db/repo.ts`(在 `openTickets` 后加新方法)
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**(新 describe)

```ts
describe("Repo tickets", () => {
  it("listTickets 含 open 与 closed,按创建时间降序", () => {
    const a = repo.createTicket("g:1", "问题A");
    const b = repo.createTicket("g:2", "问题B");
    db.prepare("UPDATE tickets SET status='closed' WHERE id=?").run(a);
    const list = repo.listTickets();
    expect(list.length).toBe(2);
    expect(list.map((t) => t.status).sort()).toEqual(["closed", "open"]);
    expect(list.find((t) => t.id === b)!.status).toBe("open");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: FAIL(`listTickets is not a function`)

- [ ] **Step 3: 加 listTickets**(紧接 `openTickets` 后)

```ts
listTickets(): { id: number; sessionKey: string; summary: string; status: string; createdAt: number }[] {
  const rows = this.db
    .prepare("SELECT id, session_key, summary, status, created_at FROM tickets ORDER BY created_at DESC")
    .all() as { id: number; session_key: string; summary: string; status: string; created_at: number }[];
  return rows.map((r) => ({ id: r.id, sessionKey: r.session_key, summary: r.summary, status: r.status, createdAt: r.created_at }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(repo): listTickets 全量工单"
```

---

## Task 3: Repo — reflectCursors 每群反思游标

**Files:**
- Modify: `lib/db/repo.ts`(在 `setGroupReflectCursor` 后加)
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**(新 describe)

```ts
describe("Repo reflection stats", () => {
  it("reflectCursors 解析 reflect_cursor:{gid} 配置", () => {
    repo.setGroupReflectCursor(100, 1700);
    repo.setGroupReflectCursor(200, 1800);
    repo.setConfigRow("app", "{}"); // 干扰项:非 reflect_cursor 前缀不应混入
    const cur = repo.reflectCursors().sort((a, b) => a.groupId - b.groupId);
    expect(cur).toEqual([
      { groupId: 100, cursor: 1700 },
      { groupId: 200, cursor: 1800 },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: FAIL(`reflectCursors is not a function`)

- [ ] **Step 3: 加 reflectCursors**(紧接 `setGroupReflectCursor` 后)

```ts
// 每群反思游标(config key = reflect_cursor:{gid}),供反思/群活动页展示进度
reflectCursors(): { groupId: number; cursor: number }[] {
  const rows = this.db
    .prepare("SELECT key, value FROM config WHERE key LIKE 'reflect_cursor:%'")
    .all() as { key: string; value: string }[];
  return rows.map((r) => ({ groupId: Number(r.key.slice("reflect_cursor:".length)), cursor: Number(r.value) }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(repo): reflectCursors 每群反思游标"
```

---

## Task 4: Repo — groupMessageStats 每群消息统计

**Files:**
- Modify: `lib/db/repo.ts`(在 `reflectCursors` 后加)
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**(加进 `describe("Repo reflection stats")`)

```ts
it("groupMessageStats 按群分组计数并取最近时间", () => {
  repo.bufferGroupMessage(100, 1, "member", "a");
  repo.bufferGroupMessage(100, 2, "admin", "b");
  repo.bufferGroupMessage(200, 3, "member", "c");
  const stats = repo.groupMessageStats().sort((x, y) => x.groupId - y.groupId);
  expect(stats.map((s) => ({ g: s.groupId, n: s.count }))).toEqual([
    { g: 100, n: 2 },
    { g: 200, n: 1 },
  ]);
  expect(stats[0].lastTs).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: FAIL(`groupMessageStats is not a function`)

- [ ] **Step 3: 加 groupMessageStats**

```ts
// 每群缓冲消息量 + 最近一条时间(反思原料规模)
groupMessageStats(): { groupId: number; count: number; lastTs: number }[] {
  return this.db
    .prepare("SELECT group_id AS groupId, COUNT(*) AS count, MAX(created_at) AS lastTs FROM group_messages GROUP BY group_id")
    .all() as { groupId: number; count: number; lastTs: number }[];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(repo): groupMessageStats 每群消息统计"
```

---

## Task 5: Repo — reflectionEntries 沉淀知识条目

**Files:**
- Modify: `lib/db/repo.ts`(在 `groupMessageStats` 后加)
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**(加进 `describe("Repo reflection stats")`)

```ts
it("reflectionEntries 解析 human-reflection 条目的来源群与时间,畸形回退 null", () => {
  const good = repo.insertKbChunk("human-reflection", "退款 7 天到账", "human-reflection:100:1700");
  const bad = repo.insertKbChunk("human-reflection", "无来源格式", "human-reflection");
  repo.insertKbChunk("faq/x.md", "普通文档", "faq/x.md"); // 非反思,不应出现
  const es = repo.reflectionEntries();
  expect(es.length).toBe(2);
  const g = es.find((e) => e.id === good)!;
  expect(g.groupId).toBe(100);
  expect(g.ts).toBe(1700);
  const b = es.find((e) => e.id === bad)!;
  expect(b.groupId).toBeNull();
  expect(b.ts).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: FAIL(`reflectionEntries is not a function`)

- [ ] **Step 3: 加 reflectionEntries**

```ts
// 反思沉淀的知识条目(doc='human-reflection');source 格式 human-reflection:{gid}:{ts},畸形回退 null
reflectionEntries(): { id: number; content: string; groupId: number | null; ts: number | null }[] {
  const rows = this.db
    .prepare("SELECT id, content, source FROM kb_chunks WHERE doc = 'human-reflection' ORDER BY id DESC")
    .all() as { id: number; content: string; source: string | null }[];
  return rows.map((r) => {
    const m = /^human-reflection:(\d+):(\d+)$/.exec(r.source ?? "");
    return { id: r.id, content: r.content, groupId: m ? Number(m[1]) : null, ts: m ? Number(m[2]) : null };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/lib/db/repo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(repo): reflectionEntries 沉淀知识条目"
```

---

## Task 6: API — /api/overview 汇总卡数据

**Files:**
- Create: `app/api/overview/route.ts`

- [ ] **Step 1: 写路由**

```ts
import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// status 页汇总卡:生效群数 + 沉淀知识总数
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    return NextResponse.json(ok({
      enabledGroups: cfg.enabledGroups.length,
      reflectionCount: repo.reflectionEntries().length,
    }));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
```

- [ ] **Step 2: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/api/overview/route.ts
git commit -m "feat(api): GET /api/overview 汇总卡数据"
```

---

## Task 7: API — /api/reflection

**Files:**
- Create: `app/api/reflection/route.ts`

- [ ] **Step 1: 写路由**

```ts
import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// 反思专页:节奏配置 + 每群进度(游标/滞后/缓冲/沉淀数) + 沉淀条目列表
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    const now = Date.now();

    const cursors = new Map(repo.reflectCursors().map((c) => [c.groupId, c.cursor]));
    const msg = new Map(repo.groupMessageStats().map((m) => [m.groupId, m]));
    const entries = repo.reflectionEntries();
    const sed = new Map<number, number>();
    for (const e of entries) if (e.groupId != null) sed.set(e.groupId, (sed.get(e.groupId) ?? 0) + 1);

    const ids = new Set<number>([...cfg.enabledGroups, ...cursors.keys(), ...msg.keys()]);
    const groups = [...ids].map((groupId) => {
      const cursor = cursors.get(groupId) ?? 0;
      return {
        groupId,
        cursor,
        lagMs: Math.max(0, now - cfg.reflectSettleMs - cursor),
        bufferCount: msg.get(groupId)?.count ?? 0,
        sedimentedCount: sed.get(groupId) ?? 0,
      };
    }).sort((a, b) => a.groupId - b.groupId);

    return NextResponse.json(ok({
      config: {
        scanMs: cfg.reflectScanMs,
        lookbackMs: cfg.reflectLookbackMs,
        settleMs: cfg.reflectSettleMs,
        windowMax: cfg.reflectWindowMax,
      },
      groups,
      entries,
    }));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
```

- [ ] **Step 2: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/api/reflection/route.ts
git commit -m "feat(api): GET /api/reflection 反思进度与沉淀条目"
```

---

## Task 8: API — /api/tickets

**Files:**
- Create: `app/api/tickets/route.ts`

- [ ] **Step 1: 写路由**

```ts
import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// 工单专页:全量工单(含 closed)
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));
    return NextResponse.json(ok(repo.listTickets()));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
```

- [ ] **Step 2: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/api/tickets/route.ts
git commit -m "feat(api): GET /api/tickets 全量工单"
```

---

## Task 9: API — /api/groups/activity

**Files:**
- Create: `app/api/groups/activity/route.ts`

- [ ] **Step 1: 写路由**

```ts
import { NextResponse } from "next/server";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";

// 生效群活动页:生效群 ∪ 有活动群,各群消息量/最近活动/反思游标/沉淀数
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
    const repo = new Repo(sharedDb(cfg.dbPath));

    const enabled = new Set(cfg.enabledGroups);
    const cursors = new Map(repo.reflectCursors().map((c) => [c.groupId, c.cursor]));
    const msg = new Map(repo.groupMessageStats().map((m) => [m.groupId, m]));
    const sed = new Map<number, number>();
    for (const e of repo.reflectionEntries()) if (e.groupId != null) sed.set(e.groupId, (sed.get(e.groupId) ?? 0) + 1);

    const ids = new Set<number>([...enabled, ...msg.keys()]);
    const list = [...ids].map((groupId) => ({
      groupId,
      enabled: enabled.has(groupId),
      messageCount: msg.get(groupId)?.count ?? 0,
      lastTs: msg.get(groupId)?.lastTs ?? 0,
      cursor: cursors.get(groupId) ?? 0,
      sedimentedCount: sed.get(groupId) ?? 0,
    })).sort((a, b) => b.messageCount - a.messageCount);

    return NextResponse.json(ok(list));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
```

- [ ] **Step 2: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/api/groups/activity/route.ts
git commit -m "feat(api): GET /api/groups/activity 生效群活动"
```

---

## Task 10: 页面 — status 补齐(A)

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: 扩展 Status 接口 + 加 overview 状态**

`Status` 接口(约 20-26 行)加 `handoffQueue: number;`。在 `StatusPage` 组件顶部 `const [busy...]` 后加:

```tsx
  const [ov, setOv] = useState<{ enabledGroups: number; reflectionCount: number } | null>(null);
```

`load()` 函数体改为并发拉两个接口:

```tsx
  async function load() {
    try {
      const [st, o] = await Promise.all([
        fetch("/api/status").then((x) => x.json()),
        fetch("/api/overview").then((x) => x.json()),
      ]);
      if (st.ok) setS(st.data);
      if (o.ok) setOv(o.data);
    } catch {
      /* 轮询失败静默 */
    }
  }
```

- [ ] **Step 2: 加图标 import + stat 卡**

第 4 行 import 追加图标:`import { Activity, Plug, Users, RotateCw, TriangleAlert, Clock, LifeBuoy, ShieldCheck, Brain } from "lucide-react";`

`stats` 数组(现 3 项)末尾追加 3 项:

```tsx
    { label: "转人工/工单", icon: LifeBuoy, value: s?.handoffQueue },
    { label: "生效群", icon: ShieldCheck, value: ov?.enabledGroups },
    { label: "沉淀知识", icon: Brain, value: ov?.reflectionCount },
```

网格类改为容纳 6 卡(现 `lg:grid-cols-4` → `lg:grid-cols-3`,两行更均衡):找到 `<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">` 改为 `lg:grid-cols-3`。

- [ ] **Step 3: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add app/admin/page.tsx
git commit -m "feat(admin): status 页补齐转人工/生效群/沉淀数"
```

---

## Task 11: 页面 — 会话页转人工态(C)

**Files:**
- Modify: `app/admin/sessions/page.tsx`

- [ ] **Step 1: 扩展 Sess 接口**(第 27 行)

```tsx
interface Sess { key: string; sessionId: string | null; humanMode: boolean; humanSince: number | null; lastQuestion: string | null; updatedAt: number; }
```

- [ ] **Step 2: import Badge + 时长工具**

第 5 行 import 追加 `UserRound`:`import { MessagesSquare, RefreshCw, Wrench, UserRound } from "lucide-react";`
在 import 区末尾(第 25 行后)加:`import { Badge } from "@/components/ui/badge";`

在组件外(文件顶部 interface 之后)加时长格式化:

```tsx
function since(ts: number | null): string {
  if (!ts) return "";
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}
```

- [ ] **Step 3: 会话列表项加转人工态**

替换列表项 `<button>` 内部(现仅 `<span className="truncate font-mono">{sess.key}</span>`)为:

```tsx
                    <span className="truncate font-mono">{sess.key}</span>
                    {sess.humanMode && (
                      <Badge variant="destructive" className="shrink-0 gap-1">
                        <UserRound className="size-3" />
                        人工{sess.humanSince ? ` ${since(sess.humanSince)}` : ""}
                      </Badge>
                    )}
```

并在列表项 `<button>` 的 `className` 里把 `items-center` 段保持;若 `humanMode` 需要显示 last_question,在 `</button>` 前不放(空间不足),改为在选中时于对话卡标题下展示。改对话卡标题区:找到 `<CardTitle className="text-sm">{active ? \`对话:${active}\` : "对话"}</CardTitle>`,其后(同 CardHeader 内)不动;转而在 `CardContent` 顶部条件插入 last_question 提示。为简化,直接在会话列表项下方补一行 last_question:

将上面列表项结构整体替换为(含 last_question 行):

```tsx
                  <button
                    key={sess.key}
                    onClick={() => open(sess)}
                    disabled={!sess.sessionId}
                    className={cn(
                      "hover:bg-muted flex flex-col gap-1 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-50",
                      active === sess.key && "bg-muted",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono">{sess.key}</span>
                      {sess.humanMode && (
                        <Badge variant="destructive" className="shrink-0 gap-1">
                          <UserRound className="size-3" />
                          人工{sess.humanSince ? ` ${since(sess.humanSince)}` : ""}
                        </Badge>
                      )}
                    </span>
                    {sess.lastQuestion && (
                      <span className="text-muted-foreground truncate">Q: {sess.lastQuestion}</span>
                    )}
                  </button>
```

- [ ] **Step 4: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add app/admin/sessions/page.tsx
git commit -m "feat(admin): 会话列表显示转人工态与最近问题"
```

---

## Task 12: 页面 — 反思专页(B)

**Files:**
- Create: `app/admin/reflection/page.tsx`

- [ ] **Step 1: 写页面**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Brain, Clock, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GroupRow { groupId: number; cursor: number; lagMs: number; bufferCount: number; sedimentedCount: number; }
interface Entry { id: number; content: string; groupId: number | null; ts: number | null; }
interface Data { config: { scanMs: number; lookbackMs: number; settleMs: number; windowMax: number }; groups: GroupRow[]; entries: Entry[]; }

const min = (ms: number) => `${Math.round(ms / 60000)} 分`;
const fmtTs = (ts: number) => (ts ? new Date(ts).toLocaleString() : "—");

export default function ReflectionPage() {
  const [d, setD] = useState<Data | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});

  async function load() {
    try {
      const r = await fetch("/api/reflection").then((x) => x.json());
      if (r.ok) setD(r.data);
    } catch {
      /* 静默 */
    }
  }
  async function loadNames() {
    try {
      const r = await fetch("/api/onebot/groups").then((x) => x.json());
      if (r.ok) setNames(Object.fromEntries((r.data as { groupId: number; groupName: string }[]).map((g) => [g.groupId, g.groupName])));
    } catch {
      /* bot 断连 → 回退裸 id */
    }
  }
  useEffect(() => {
    load();
    loadNames();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const name = (gid: number) => names[gid] ?? String(gid);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">反思</h1>
        <p className="text-muted-foreground text-sm">被动反思:从人工回复中沉淀知识(每 3 秒刷新)。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Clock className="size-4" />扫描周期</CardDescription><CardTitle className="text-2xl">{d ? min(d.config.scanMs) : "—"}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Clock className="size-4" />沉降延迟</CardDescription><CardTitle className="text-2xl">{d ? min(d.config.settleMs) : "—"}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Layers className="size-4" />回溯窗口</CardDescription><CardTitle className="text-2xl">{d ? min(d.config.lookbackMs) : "—"}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Layers className="size-4" />窗口上限</CardDescription><CardTitle className="text-2xl">{d ? d.config.windowMax : "—"}</CardTitle></CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">每群反思进度</CardTitle></CardHeader>
        <CardContent>
          {!d || d.groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无群反思记录。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>群</TableHead>
                  <TableHead>游标时间</TableHead>
                  <TableHead className="text-right">滞后</TableHead>
                  <TableHead className="text-right">缓冲消息</TableHead>
                  <TableHead className="text-right">已沉淀</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.groups.map((g) => (
                  <TableRow key={g.groupId}>
                    <TableCell className="font-medium">{name(g.groupId)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtTs(g.cursor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.lagMs > 0 ? min(g.lagMs) : "0"}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.bufferCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.sedimentedCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Brain className="size-4" />沉淀知识 {d && `(${d.entries.length})`}</CardTitle>
          <CardDescription>反思写入 kb 的 human-reflection 条目,Agent 检索可命中。</CardDescription>
        </CardHeader>
        <CardContent>
          {!d || d.entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无沉淀条目。</p>
          ) : (
            <ScrollArea className="h-[400px] pr-3">
              <div className="flex flex-col gap-2">
                {d.entries.map((e) => (
                  <div key={e.id} className="bg-muted/40 rounded-md border p-3">
                    <div className="text-muted-foreground mb-1.5 flex items-center gap-2 text-xs">
                      {e.groupId != null && <Badge variant="secondary">{name(e.groupId)}</Badge>}
                      <span>{e.ts ? fmtTs(e.ts) : "—"}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{e.content}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/admin/reflection/page.tsx
git commit -m "feat(admin): 反思专页(节奏/进度/沉淀条目)"
```

---

## Task 13: 页面 — 工单专页(D)

**Files:**
- Create: `app/admin/tickets/page.tsx`

- [ ] **Step 1: 写页面**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Row { id: number; sessionKey: string; summary: string; status: string; createdAt: number; }

export default function TicketsPage() {
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    try {
      const r = await fetch("/api/tickets").then((x) => x.json());
      if (r.ok) setRows(r.data);
    } catch {
      /* 静默 */
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const open = rows.filter((r) => r.status === "open").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">工单</h1>
        <p className="text-muted-foreground text-sm">转人工触发的工单,共 {rows.length} 条,{open} 条待处理(每 3 秒刷新)。</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Ticket className="size-4" />工单列表</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无工单。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>会话</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">{r.id}</TableCell>
                    <TableCell>
                      <Link href="/admin/sessions" className="font-mono text-xs underline-offset-2 hover:underline">{r.sessionKey}</Link>
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate">{r.summary}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "open" ? "default" : "secondary"}>{r.status === "open" ? "待处理" : "已关闭"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
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

- [ ] **Step 2: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/admin/tickets/page.tsx
git commit -m "feat(admin): 工单专页(全量 open/closed)"
```

---

## Task 14: 页面 — 生效群活动页(E)

**Files:**
- Create: `app/admin/groups/page.tsx`

- [ ] **Step 1: 写页面**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Row { groupId: number; enabled: boolean; messageCount: number; lastTs: number; cursor: number; sedimentedCount: number; }

const fmtTs = (ts: number) => (ts ? new Date(ts).toLocaleString() : "—");

export default function GroupsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});

  async function load() {
    try {
      const r = await fetch("/api/groups/activity").then((x) => x.json());
      if (r.ok) setRows(r.data);
    } catch {
      /* 静默 */
    }
  }
  async function loadNames() {
    try {
      const r = await fetch("/api/onebot/groups").then((x) => x.json());
      if (r.ok) setNames(Object.fromEntries((r.data as { groupId: number; groupName: string }[]).map((g) => [g.groupId, g.groupName])));
    } catch {
      /* bot 断连 → 回退裸 id */
    }
  }
  useEffect(() => {
    load();
    loadNames();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const name = (gid: number) => names[gid] ?? String(gid);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">生效群</h1>
        <p className="text-muted-foreground text-sm">生效群与有活动的群的运行概览(每 3 秒刷新)。</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Users className="size-4" />群活动</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无群活动。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>群</TableHead>
                  <TableHead>生效</TableHead>
                  <TableHead className="text-right">消息量</TableHead>
                  <TableHead>最近活动</TableHead>
                  <TableHead className="text-right">已沉淀</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.groupId}>
                    <TableCell className="font-medium">{name(r.groupId)}</TableCell>
                    <TableCell>
                      <Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "生效" : "未生效"}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.messageCount}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtTs(r.lastTs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sedimentedCount}</TableCell>
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

- [ ] **Step 2: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/admin/groups/page.tsx
git commit -m "feat(admin): 生效群活动页"
```

---

## Task 15: 导航 — sidebar 增 3 项

**Files:**
- Modify: `components/app-sidebar.tsx:5,17-23`

- [ ] **Step 1: 加图标 import**(第 5 行)

```tsx
import { Activity, Settings, BookOpen, MessagesSquare, ScrollText, Bot, Brain, Ticket, Users } from "lucide-react";
```

- [ ] **Step 2: nav 数组加 3 项**(插在 会话 与 运行日志 之间,逻辑分组)

```tsx
const nav = [
  { href: "/admin", label: "运行状态", icon: Activity },
  { href: "/admin/config", label: "配置", icon: Settings },
  { href: "/admin/kb", label: "知识库", icon: BookOpen },
  { href: "/admin/sessions", label: "会话", icon: MessagesSquare },
  { href: "/admin/reflection", label: "反思", icon: Brain },
  { href: "/admin/tickets", label: "工单", icon: Ticket },
  { href: "/admin/groups", label: "生效群", icon: Users },
  { href: "/admin/logs", label: "运行日志", icon: ScrollText },
];
```

- [ ] **Step 3: 验证**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add components/app-sidebar.tsx
git commit -m "feat(admin): 侧栏增反思/工单/生效群导航"
```

---

## Task 16: 全量验证 + 冒烟

**Files:** 无(验证)

- [ ] **Step 1: 全测试**

Run: `pnpm test`
Expected: 全绿(含新增 repo 单测)

- [ ] **Step 2: 构建**

Run: `pnpm build`
Expected: 编译成功,新路由 `/admin/reflection`、`/admin/tickets`、`/admin/groups`、`/api/overview`、`/api/reflection`、`/api/tickets`、`/api/groups/activity` 出现在路由表

- [ ] **Step 3: 浏览器冒烟**(若 dev server 在 :3000)

逐一访问 `/admin`(6 卡)、`/admin/reflection`、`/admin/tickets`、`/admin/groups`、`/admin/sessions`(转人工徽标),确认渲染无控制台报错。空数据时显示占位文案。

- [ ] **Step 4: 无新提交**(前序任务已各自提交)

---

## Self-Review 记录

- **Spec 覆盖**:A→Task 6/10;B→Task 3/4/5/7/12;C→Task 1/11;D→Task 2/8/13;E→Task 4/9/14;导航→Task 15;测试→Task 1-5 单测 + Task 16 冒烟。全覆盖。
- **类型一致**:repo 方法名 `listSessions`/`listTickets`/`reflectCursors`/`groupMessageStats`/`reflectionEntries` 全程一致;API 字段 `handoffQueue`/`enabledGroups`/`reflectionCount`/`lagMs`/`sedimentedCount` 前后端对齐。
- **占位扫描**:无 TBD/TODO,每步含完整代码。
- **依赖**:`/api/onebot/groups` 已存在(归一化 `{groupId,groupName}`);`Table` 组件已存在(`components/ui/table.tsx`)。
