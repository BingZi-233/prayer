# 管理后台 UX 改进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从运维使用视角打通「转人工响应」动线并做全站信息/交互优化,保持现有 mono+灰阶风格,零新依赖,纯前端(不发消息、不改后端可变状态)。

**Architecture:** 新增客户端 `LiveProvider` Context 在 admin layout 轮询 `status`+`overview`,向 header 状态点与侧栏角标派发;`/api/overview` 扩展两个计数字段(复用已有 repo 方法)。新增 `RelativeTime`/`ThemeToggle`/`PollingIndicator` 通用组件全站复用。工单/会话/日志页做动线与筛选改进。

**Tech Stack:** Next.js 16 App Router、React 19、shadcn/ui、next-themes、lucide-react、sonner、better-sqlite3(仅后端 overview)。

**验证约定:** 后端改动跑 `pnpm typecheck` + `pnpm test`;前端展示层无单测基建,用 `pnpm dev` + Playwright MCP 手动冒烟 + `pnpm typecheck` 兜底类型。每任务末尾 commit。

**参考事实(已核对):**
- session key = `` `${groupId}:${userId}` ``(`lib/agent/gateway.ts:39`),解析:`key.split(":")` → `[0]`=groupId、`[1]`=userId。
- `repo.openTickets()`、`repo.listSessions()`(含 `humanMode`)已存在且有测试(`tests/lib/db/repo.stats.test.ts`)。
- `/api/onebot/groups` → `{ groupId, groupName }[]`,断连失败回退裸 id。群名解析模式见 `app/admin/reflection/page.tsx:29-44`。
- `components/ui/sidebar.tsx` 导出 `SidebarMenuBadge`。
- `ThemeProvider`(`components/theme-provider.tsx`)已有 `d` 热键 + `useTheme`。
- `components/ui/dialog.tsx` 导出 `DialogContent/Header/Title/Description/Footer/Close/Trigger`。

---

## 文件结构

**新建:**
- `components/live-provider.tsx` — admin 全局实时信号 Context(轮询 status+overview,派发 + 改 document.title)
- `components/relative-time.tsx` — `<RelativeTime ts>` 相对时间(title 挂绝对时间,30s 刷新)
- `components/theme-toggle.tsx` — sun/moon 主题切换按钮
- `components/polling-indicator.tsx` — 「实时 · Xs 前」脉冲指示
- `lib/group-name.ts` — 群名解析 hook `useGroupNames()`(复用消除 reflection/groups/tickets/sessions 重复)

**修改:**
- `app/api/overview/route.ts` — 加 `openTickets`/`humanSessions`
- `app/admin/layout.tsx` — 包 LiveProvider、header 状态点 + ThemeToggle + PollingIndicator
- `components/app-sidebar.tsx` — 工单/会话角标
- `app/admin/page.tsx` — 待处理提醒卡、RelativeTime、重启二次确认
- `app/admin/tickets/page.tsx` — 群名、查看会话跳转、Empty、RelativeTime
- `app/admin/sessions/page.tsx` — ?key 自动打开、群名、仅人工筛选、搜索、自动轮询
- `app/admin/logs/page.tsx` — 级别筛选、搜索、暂停滚动、复制、Empty
- `app/admin/reflection/page.tsx` — RelativeTime、Empty
- `app/admin/groups/page.tsx` — RelativeTime、Empty
- `app/admin/config/page.tsx` — `✕`→X icon

---

# 批 1 — 转人工动线(痛点 1+2)

## Task 1: `/api/overview` 扩展计数

**Files:**
- Modify: `app/api/overview/route.ts`
- Test: `tests/lib/db/repo.stats.test.ts`(已存在,追加一条断言)

- [ ] **Step 1: 追加 repo 层断言测试(humanSessions 过滤逻辑)**

在 `tests/lib/db/repo.stats.test.ts` 的 `describe` 内追加:

```ts
  it("listSessions 可据 humanMode 计数人工会话", () => {
    const repo = mkRepo();
    repo.setSessionId("g1:u1", "s1");
    repo.setSessionId("g1:u2", "s2");
    repo.setHumanMode("g1:u1", true); // 若无该方法则用现有置人工路径,见下方 Step 2 说明
    const human = repo.listSessions().filter((s) => s.humanMode).length;
    expect(human).toBe(1);
  });
```

- [ ] **Step 2: 跑测试确认(先确认 setHumanMode 是否存在)**

Run: `pnpm test -- repo.stats`
若报 `repo.setHumanMode is not a function`,说明置人工方法名不同 —— 执行 `grep -n "human_mode" lib/db/repo.ts` 查实际写方法名替换;若确无写方法(人工态由别处 SQL 写入),则把该测试改为直接构造:

```ts
    repo.setSessionId("g1:u1", "s1");
    // 直接置 human_mode 验证 listSessions 映射
    (repo as unknown as { db: import("better-sqlite3").Database }).db
      .prepare("UPDATE sessions SET human_mode = 1 WHERE key = ?").run("g1:u1");
    expect(repo.listSessions().filter((s) => s.humanMode).length).toBe(1);
```

Expected: 最终 PASS。

- [ ] **Step 3: 扩展 overview route**

`app/api/overview/route.ts` 中 `ok({...})` 改为:

```ts
    return NextResponse.json(ok({
      enabledGroups: cfg.enabledGroups.length,
      reflectionCount: repo.reflectionEntries().length,
      openTickets: repo.openTickets().length,
      humanSessions: repo.listSessions().filter((s) => s.humanMode).length,
    }));
```

- [ ] **Step 4: typecheck + test**

Run: `pnpm typecheck && pnpm test -- repo.stats`
Expected: 均 PASS。

- [ ] **Step 5: Commit**

```bash
git add app/api/overview/route.ts tests/lib/db/repo.stats.test.ts
git commit -m "feat(api): overview 加 openTickets/humanSessions 计数"
```

---

## Task 2: 群名解析 hook `useGroupNames`

**Files:**
- Create: `lib/group-name.ts`

- [ ] **Step 1: 写 hook(消除 reflection/groups/tickets/sessions 重复)**

`lib/group-name.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

// 拉 /api/onebot/groups 建 groupId→groupName 映射;bot 断连时失败 → name(gid) 回退裸 id
export function useGroupNames() {
  const [names, setNames] = useState<Record<number, string>>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/onebot/groups")
      .then((x) => x.json())
      .then((r) => {
        if (alive && r.ok) {
          setNames(
            Object.fromEntries(
              (r.data as { groupId: number; groupName: string }[]).map((g) => [g.groupId, g.groupName]),
            ),
          );
        }
      })
      .catch(() => {
        /* bot 断连 → 回退裸 id */
      });
    return () => {
      alive = false;
    };
  }, []);

  const name = (gid: number) => names[gid] ?? String(gid);
  // session key "gid:uid" → "群名 · uid";非法则原样返回
  const label = (key: string) => {
    const [gid, uid] = key.split(":");
    const g = Number(gid);
    if (!gid || Number.isNaN(g)) return key;
    return uid ? `${name(g)} · ${uid}` : name(g);
  };
  return { names, name, label };
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add lib/group-name.ts
git commit -m "feat(admin): 群名解析 useGroupNames hook"
```

---

## Task 3: `LiveProvider` 全局实时信号

**Files:**
- Create: `components/live-provider.tsx`

- [ ] **Step 1: 写 Provider + useLive + document.title**

`components/live-provider.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface Status {
  state: string;
  wsConnected: boolean;
  sessionCount: number;
  handoffQueue: number;
  lastError?: string;
  bootedAt?: number;
}
interface Overview {
  enabledGroups: number;
  reflectionCount: number;
  openTickets: number;
  humanSessions: number;
}
interface Live {
  status: Status | null;
  overview: Overview | null;
  lastUpdated: number | null;
}

const LiveCtx = createContext<Live>({ status: null, overview: null, lastUpdated: null });

export function useLive() {
  return useContext(LiveCtx);
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [st, ov] = await Promise.all([
          fetch("/api/status").then((x) => x.json()),
          fetch("/api/overview").then((x) => x.json()),
        ]);
        if (!alive) return;
        if (st.ok) setStatus(st.data);
        if (ov.ok) setOverview(ov.data);
        setLastUpdated(Date.now());
      } catch {
        /* 轮询失败静默,保留上次值 */
      }
    }
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // tab 标题:有待处理工单 → "(N) 客服 Agent",离开页面也瞥得见
  useEffect(() => {
    const n = overview?.openTickets ?? 0;
    document.title = n > 0 ? `(${n}) 客服 Agent` : "客服 Agent";
  }, [overview?.openTickets]);

  return <LiveCtx.Provider value={{ status, overview, lastUpdated }}>{children}</LiveCtx.Provider>;
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add components/live-provider.tsx
git commit -m "feat(admin): LiveProvider 全局实时信号 context"
```

---

## Task 4: layout 挂 LiveProvider + header 状态点

**Files:**
- Modify: `app/admin/layout.tsx`

- [ ] **Step 1: 改写 layout**

`app/admin/layout.tsx` 全量替换:

```tsx
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { LiveProvider } from "@/components/live-provider";
import { HeaderStatus } from "@/components/header-status";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <span className="text-sm font-medium">OneBot 客服 Agent</span>
            <HeaderStatus />
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </LiveProvider>
  );
}
```

- [ ] **Step 2: 写 HeaderStatus(状态点,右侧留占位待 Task 11/12 填充)**

`components/header-status.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";
import { useLive } from "@/components/live-provider";

const STATE_LABEL: Record<string, string> = {
  running: "运行中",
  stopped: "已停止",
  starting: "启动中",
  error: "错误",
};

export function HeaderStatus() {
  const { status } = useLive();
  const state = status?.state;
  const dot =
    state === "running"
      ? "bg-primary"
      : state === "error"
        ? "bg-destructive"
        : "bg-muted-foreground/50";
  return (
    <div className="ml-auto flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 rounded-full", dot, state === "running" && "animate-pulse")} />
        <span className="text-muted-foreground">{status ? (STATE_LABEL[state!] ?? state) : "…"}</span>
        {status && !status.wsConnected && <span className="text-muted-foreground">· WS 断开</span>}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。
再 `pnpm dev`,Playwright MCP 打开 `http://localhost:3000/admin`,确认 header 右侧出现状态点 + 文案(运行时绿点脉冲 / 停止灰点)。

- [ ] **Step 4: Commit**

```bash
git add app/admin/layout.tsx components/header-status.tsx
git commit -m "feat(admin): header 全局运行状态点 + 挂 LiveProvider"
```

---

## Task 5: 侧栏工单/会话角标

**Files:**
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: 改 app-sidebar 用 useLive 加角标**

在 `components/app-sidebar.tsx`:顶部 import 加 `import { useLive } from "@/components/live-provider";` 和 `SidebarMenuBadge`(从已有 sidebar import 补入)。

`nav` 数组每项加可选 `badge` 键:

```tsx
const nav = [
  { href: "/admin", label: "运行状态", icon: Activity },
  { href: "/admin/config", label: "配置", icon: Settings },
  { href: "/admin/kb", label: "知识库", icon: BookOpen },
  { href: "/admin/sessions", label: "会话", icon: MessagesSquare, badge: "human" as const },
  { href: "/admin/reflection", label: "反思", icon: Brain },
  { href: "/admin/tickets", label: "工单", icon: Ticket, badge: "tickets" as const },
  { href: "/admin/groups", label: "生效群", icon: Users },
  { href: "/admin/logs", label: "运行日志", icon: ScrollText },
];
```

组件内 `const pathname = usePathname();` 下加 `const { overview } = useLive();`,并在 map 里 Link 后渲染角标:

```tsx
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={n.label}>
                      <Link href={n.href}>
                        <n.icon />
                        <span>{n.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {n.badge === "tickets" && (overview?.openTickets ?? 0) > 0 && (
                      <SidebarMenuBadge>{overview!.openTickets}</SidebarMenuBadge>
                    )}
                    {n.badge === "human" && (overview?.humanSessions ?? 0) > 0 && (
                      <SidebarMenuBadge className="text-destructive">{overview!.humanSessions}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
```

- [ ] **Step 2: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:制造一条 open 工单(或 DB 里已有)后,侧栏「工单」右侧出现数字角标;有人工会话时「会话」角标为红。

- [ ] **Step 3: Commit**

```bash
git add components/app-sidebar.tsx
git commit -m "feat(admin): 侧栏工单待处理/人工会话角标"
```

---

## Task 6: overview 待处理提醒卡 + RelativeTime bootedAt

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: 加提醒卡(openTickets 或 humanSessions >0 才渲染)**

`app/admin/page.tsx`:import 加 `import Link from "next/link";`、`import { LifeBuoy } from "lucide-react";`(已在 import 列表则跳过)。在返回 JSX 顶部标题块之后、stats grid 之前插入:

```tsx
      {(ov?.openTickets ?? 0) > 0 || (ov?.humanSessions ?? 0) > 0 ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2 text-base">
              <LifeBuoy className="size-4" />
              有待处理事项
            </CardTitle>
            <CardDescription>转人工客户正在等待,请尽快处理。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(ov?.openTickets ?? 0) > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/tickets">待处理工单 {ov!.openTickets}</Link>
              </Button>
            )}
            {(ov?.humanSessions ?? 0) > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/sessions?human=1">人工会话 {ov!.humanSessions}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}
```

- [ ] **Step 2: 扩展本页 Overview 类型 + bootedAt 用 RelativeTime**

`app/admin/page.tsx` 里 `useState<{ enabledGroups: number; reflectionCount: number } | null>` 改为:

```tsx
  const [ov, setOv] = useState<{ enabledGroups: number; reflectionCount: number; openTickets: number; humanSessions: number } | null>(null);
```

底部 `启动于 {new Date(s.bootedAt).toLocaleString()}` 改为(RelativeTime 由 Task 9 提供;若 Task 9 未先做,此步 import 后即可用):

```tsx
          启动于 <RelativeTime ts={s.bootedAt} />
```

并 import `import { RelativeTime } from "@/components/relative-time";`。

> 注:本任务依赖 Task 9 的 RelativeTime。执行顺序:先做 Task 9 或本步与 Task 9 合并提交。若批 1 先行,可暂保留 `toLocaleString()`,Task 10 统一替换。**推荐:本步只加提醒卡与类型扩展,bootedAt 替换留到 Task 10。**

- [ ] **Step 3: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:有 open 工单时概览页顶部出现红框提醒卡 + 跳转按钮。

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat(admin): 概览页待处理事项提醒卡"
```

---

## Task 7: 工单页群名 + 查看会话跳转 + Empty

**Files:**
- Modify: `app/admin/tickets/page.tsx`

- [ ] **Step 1: 引入群名 hook + Empty + 跳转按钮**

`app/admin/tickets/page.tsx` import 追加:

```tsx
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { useGroupNames } from "@/lib/group-name";
```

组件内 `const [rows, setRows] = useState<Row[]>([]);` 下加 `const { label } = useGroupNames();`。

表格「会话」单元格从裸 Link 改为群名 label + 「查看会话」按钮:

```tsx
                    <TableCell>
                      <span className="text-xs">{label(r.sessionKey)}</span>
                    </TableCell>
```

在「状态」列后、「创建时间」前(或行尾)加操作列。表头加 `<TableHead className="w-24">操作</TableHead>`,行加:

```tsx
                    <TableCell>
                      <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        <Link href={`/admin/sessions?key=${encodeURIComponent(r.sessionKey)}`}>查看会话</Link>
                      </Button>
                    </TableCell>
```

空状态 `<p>暂无工单。</p>` 替换为:

```tsx
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Ticket /></EmptyMedia>
                <EmptyTitle>暂无工单</EmptyTitle>
                <EmptyDescription>转人工触发时会在此生成工单。</EmptyDescription>
              </EmptyHeader>
            </Empty>
```

- [ ] **Step 2: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:工单行会话列显「群名 · QQ」;点「查看会话」跳到 `/admin/sessions?key=...`。

- [ ] **Step 3: Commit**

```bash
git add app/admin/tickets/page.tsx
git commit -m "feat(admin): 工单页群名解析 + 查看会话跳转 + Empty"
```

---

## Task 8: 会话页 ?key 自动打开 + 群名 + 仅人工 + 搜索 + 自动轮询

**Files:**
- Modify: `app/admin/sessions/page.tsx`

- [ ] **Step 1: 引入依赖 + 群名 + URL 参数**

import 追加:

```tsx
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useGroupNames } from "@/lib/group-name";
```

> 注:`useSearchParams` 需 Suspense 边界。将现有默认导出组件改名为 `SessionsInner`,新增默认导出包一层:

```tsx
import { Suspense } from "react";
export default function SessionsPage() {
  return (
    <Suspense fallback={null}>
      <SessionsInner />
    </Suspense>
  );
}
```

- [ ] **Step 2: 组件内加状态 + 群名 + 筛选逻辑**

`SessionsInner` 内 state 区加:

```tsx
  const { label } = useGroupNames();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [humanOnly, setHumanOnly] = useState(params.get("human") === "1");
```

派生过滤列表(在 return 前):

```tsx
  const shown = sessions
    .filter((s) => (humanOnly ? s.humanMode : true))
    .filter((s) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        s.key.toLowerCase().includes(q) ||
        label(s.key).toLowerCase().includes(q) ||
        (s.lastQuestion ?? "").toLowerCase().includes(q)
      );
    })
    // 人工优先置顶,其余按更新时间(sessions 已按 updatedAt DESC)
    .sort((a, b) => Number(b.humanMode) - Number(a.humanMode));
```

- [ ] **Step 3: ?key 自动打开 + 列表自动轮询**

在现有 `useEffect(loadSessions, [])` 后加两个 effect:

```tsx
  // URL ?key=... → 自动打开对应会话
  useEffect(() => {
    const key = params.get("key");
    if (!key) return;
    const s = sessions.find((x) => x.key === key);
    if (s && active !== s.key) open(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, params]);

  // 列表自动轮询(3s);选中会话有更新则一并刷新 transcript(复用 refresh)
  useEffect(() => {
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
```

- [ ] **Step 4: 列表渲染改群名 + 加筛选 UI**

会话列表 Card 的 `CardHeader` 下、列表上方加筛选条:

```tsx
          <CardContent className="flex flex-col gap-2">
            <Input
              placeholder="搜索群名 / QQ / 问题…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-xs"
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={humanOnly} onCheckedChange={(v) => setHumanOnly(!!v)} />
              仅看人工会话
            </label>
```

列表 `.map` 数据源从 `sessions` 改 `shown`;列表项显示的 `sess.key` 改为群名 label(保留 key 作 title):

```tsx
                      <span className="truncate font-mono" title={sess.key}>{label(sess.key)}</span>
```

`sessions.length === 0` 空判断改为 `shown.length === 0`,文案区分「暂无会话 / 无匹配会话」:

```tsx
            {shown.length === 0 ? (
              <p className="text-muted-foreground text-sm">{sessions.length === 0 ? "暂无会话。" : "无匹配会话。"}</p>
            ) : (
```

CardDescription 计数改 `{shown.length} / {sessions.length} 个会话`。

- [ ] **Step 5: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:
- 访问 `/admin/sessions?key=<某key>` 自动打开该会话;
- `?human=1` 进入时「仅看人工」已勾选;
- 搜索框过滤;人工会话置顶且红 badge;
- 列表每 3s 自动刷新,打开的 transcript 不被清空。

- [ ] **Step 6: Commit**

```bash
git add app/admin/sessions/page.tsx
git commit -m "feat(admin): 会话页 ?key 自动打开 + 群名 + 仅人工筛选 + 搜索 + 自动轮询"
```

---

# 批 2 — 支撑改进(痛点 3+4)

## Task 9: `RelativeTime` 组件

**Files:**
- Create: `components/relative-time.tsx`

- [ ] **Step 1: 写组件**

`components/relative-time.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

function rel(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 0) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString();
}

// 相对时间;title 挂绝对时间;30s 刷新保持新鲜
export function RelativeTime({ ts }: { ts: number | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!ts) return <span>—</span>;
  return (
    <span title={new Date(ts).toLocaleString()} suppressHydrationWarning>
      {rel(ts, now)}
    </span>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add components/relative-time.tsx
git commit -m "feat(admin): RelativeTime 相对时间组件"
```

---

## Task 10: 全站替换绝对时间戳

**Files:**
- Modify: `app/admin/page.tsx`、`app/admin/tickets/page.tsx`、`app/admin/reflection/page.tsx`、`app/admin/groups/page.tsx`

- [ ] **Step 1: 各页 import + 替换**

四页均 import:`import { RelativeTime } from "@/components/relative-time";`

- `app/admin/page.tsx`:`启动于 {new Date(s.bootedAt).toLocaleString()}` → `启动于 <RelativeTime ts={s.bootedAt} />`
- `app/admin/tickets/page.tsx`:`{new Date(r.createdAt).toLocaleString()}` → `<RelativeTime ts={r.createdAt} />`
- `app/admin/reflection/page.tsx`:删 `fmtTs` 中展示用途;`{g.cursor ? fmtTs(g.cursor) : "—"}` → `<RelativeTime ts={g.cursor} />`;`{e.ts ? fmtTs(e.ts) : "—"}` → `<RelativeTime ts={e.ts} />`(保留 `min()`)。
- `app/admin/groups/page.tsx`:`{fmtTs(r.lastTs)}` → `<RelativeTime ts={r.lastTs} />`;`{r.cursor ? fmtTs(r.cursor) : "—"}` → `<RelativeTime ts={r.cursor} />`。删无用 `fmtTs`。

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS(若 `fmtTs` 变未使用会 lint 报错 → 删除该函数)。

- [ ] **Step 3: 冒烟**

Playwright MCP 打开各页,时间显示为「x 分钟前」,hover 显绝对时间。

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx app/admin/tickets/page.tsx app/admin/reflection/page.tsx app/admin/groups/page.tsx
git commit -m "refactor(admin): 全站时间戳改 RelativeTime"
```

---

## Task 11: `ThemeToggle` + 挂 header

**Files:**
- Create: `components/theme-toggle.tsx`
- Modify: `components/header-status.tsx`

- [ ] **Step 1: 写 ThemeToggle**

`components/theme-toggle.tsx`:

```tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title="切换主题(快捷键 d)"
    >
      {dark ? <Sun /> : <Moon />}
      <span className="sr-only">切换主题</span>
    </Button>
  );
}
```

- [ ] **Step 2: 挂进 HeaderStatus 右侧**

`components/header-status.tsx` 顶部 import `import { ThemeToggle } from "@/components/theme-toggle";`。在外层 `<div className="ml-auto flex items-center gap-3 text-xs">` 内、状态 span 之后加 `<ThemeToggle />`。

- [ ] **Step 3: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:header 右侧月亮/太阳按钮,点击切换明暗,`d` 热键仍有效。

- [ ] **Step 4: Commit**

```bash
git add components/theme-toggle.tsx components/header-status.tsx
git commit -m "feat(admin): header 主题切换按钮"
```

---

## Task 12: `PollingIndicator` + 挂 header

**Files:**
- Create: `components/polling-indicator.tsx`
- Modify: `components/header-status.tsx`

- [ ] **Step 1: 写指示器(消费 useLive.lastUpdated,自更新秒数)**

`components/polling-indicator.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/components/live-provider";

export function PollingIndicator() {
  const { lastUpdated } = useLive();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!lastUpdated) return null;
  const sec = Math.max(0, Math.floor((now - lastUpdated) / 1000));
  return (
    <span className="text-muted-foreground flex items-center gap-1.5" suppressHydrationWarning>
      <span className="bg-primary size-1.5 animate-pulse rounded-full" />
      实时 · {sec}s 前
    </span>
  );
}
```

- [ ] **Step 2: 挂进 HeaderStatus(ThemeToggle 之前)**

`components/header-status.tsx` import `import { PollingIndicator } from "@/components/polling-indicator";`,在状态 span 与 ThemeToggle 之间加 `<PollingIndicator />`。

- [ ] **Step 3: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:header 显「实时 · Xs 前」,秒数每秒+1,轮询命中后归零。

- [ ] **Step 4: Commit**

```bash
git add components/polling-indicator.tsx components/header-status.tsx
git commit -m "feat(admin): header 轮询实时指示"
```

---

## Task 13: 统一 Empty 空状态(groups/reflection/logs)

**Files:**
- Modify: `app/admin/groups/page.tsx`、`app/admin/reflection/page.tsx`、`app/admin/logs/page.tsx`

- [ ] **Step 1: 三页替换裸 `<p>`**

各页 import:`import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";`

- `groups`:`<p>暂无群活动。</p>` →
```tsx
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Users /></EmptyMedia>
                <EmptyTitle>暂无群活动</EmptyTitle>
                <EmptyDescription>生效群产生消息后会在此展示。</EmptyDescription>
              </EmptyHeader>
            </Empty>
```
- `reflection`:「每群反思进度」`<p>暂无群反思记录。</p>` 与「沉淀知识」`<p>暂无沉淀条目。</p>` 各替换为对应 Empty(icon 用 `Brain`,标题分别「暂无反思记录」「暂无沉淀知识」)。
- `logs`:`<p>暂无日志。</p>` → Empty(icon `ScrollText`,标题「暂无日志」,描述「Agent 运行后会输出日志。」)。

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/admin/groups/page.tsx app/admin/reflection/page.tsx app/admin/logs/page.tsx
git commit -m "refactor(admin): 统一空状态用 Empty 组件"
```

---

## Task 14: 日志页升级(级别筛选 + 搜索 + 暂停滚动 + 复制)

**Files:**
- Modify: `app/admin/logs/page.tsx`

- [ ] **Step 1: 加控制状态 + 派生 + 自动滚动**

import 追加:

```tsx
import { useRef } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Pause, Play } from "lucide-react";
```

组件内 state 追加:

```tsx
  const [levels, setLevels] = useState<Set<string>>(new Set(["info", "warn", "error"]));
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
```

派生 + 自动滚动:

```tsx
  const shown = logs.filter(
    (l) => levels.has(l.level) && (!query.trim() || l.msg.toLowerCase().includes(query.toLowerCase())),
  );

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [shown.length, paused]);

  function toggleLevel(lv: string) {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });
  }
  function copyAll() {
    const text = shown.map((l) => `${new Date(l.ts).toLocaleTimeString()} [${l.level}] ${l.msg}`).join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success(`已复制 ${shown.length} 条`),
      () => toast.error("复制失败"),
    );
  }
```

- [ ] **Step 2: 加工具条 UI + 用 shown 渲染 + bottomRef**

CardHeader 内 CardDescription 下方(或 CardHeader 改为含工具条)加:

```tsx
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {(["info", "warn", "error"] as const).map((lv) => (
              <Badge
                key={lv}
                variant={levels.has(lv) ? "default" : "outline"}
                className="cursor-pointer select-none uppercase"
                onClick={() => toggleLevel(lv)}
              >
                {lv}
              </Badge>
            ))}
            <Input
              placeholder="搜索日志…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 w-48 text-xs"
            />
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play /> : <Pause />}
              {paused ? "继续滚动" : "暂停滚动"}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copyAll}>
              <Copy /> 复制
            </Button>
          </div>
```

日志渲染的 `logs.map` 改 `shown.map`;在滚动容器内容末尾加 `<div ref={bottomRef} />`。空判断 `logs.length === 0` 保持(Empty),但列表区无匹配时可显 `shown.length === 0 && logs.length > 0` → 「无匹配日志」小字。

- [ ] **Step 3: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:切级别 Badge 过滤;搜索过滤;暂停后新日志不自动滚底;复制 toast 成功。

- [ ] **Step 4: Commit**

```bash
git add app/admin/logs/page.tsx
git commit -m "feat(admin): 日志页级别筛选/搜索/暂停滚动/复制"
```

---

## Task 15: config 生效群 `✕` → X icon

**Files:**
- Modify: `app/admin/config/page.tsx`

- [ ] **Step 1: 替换字符为 icon**

import 加 `X`:`import { Save, ChevronsUpDown, X } from "lucide-react";`

生效群 Badge 内 `{groupName(id)} ✕` 改为:

```tsx
                              <Badge key={id} variant="secondary" className="cursor-pointer gap-1" onClick={() => toggleGroup(id)}>
                                {groupName(id)}
                                <X className="size-3" />
                              </Badge>
```

- [ ] **Step 2: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:生效群标签显 X 图标,点击移除。

- [ ] **Step 3: Commit**

```bash
git add app/admin/config/page.tsx
git commit -m "polish(admin): 生效群标签 ✕ 字符改 X icon"
```

---

## Task 16: overview 重启二次确认

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: 用 Dialog 包重启按钮**

import 加:

```tsx
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
```

原重启 `<Button onClick={restart}>...</Button>` 替换为:

```tsx
        <Dialog>
          <DialogTrigger asChild>
            <Button disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
              {busy ? "重启中…" : "重启 Agent"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认重启 Agent?</DialogTitle>
              <DialogDescription>
                重启会断开当前 WS 连接并重新装配 Agent,进行中的会话可能中断。运行日志将清空。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">取消</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={restart} disabled={busy}>确认重启</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
```

- [ ] **Step 2: typecheck + 冒烟**

Run: `pnpm typecheck`
Expected: PASS。冒烟:点「重启 Agent」弹确认框,取消不重启,确认才触发。

- [ ] **Step 3: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat(admin): 重启 Agent 二次确认"
```

---

## 收尾:全量校验

- [ ] **Step 1: 全量 typecheck + lint + test**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 均 PASS(后端 126 tests + 新增 repo 断言绿)。

- [ ] **Step 2: 端到端冒烟(Playwright MCP)**

`pnpm dev` 后依次验证:header 状态点+主题+轮询指示、侧栏角标、tab 标题随工单变、概览提醒卡跳转、工单→会话动线、会话筛选/自动打开、日志筛选、各页相对时间。

- [ ] **Step 3: 更新 memory**

在 `onebot-agent-progress.md` 追加一行:后台 UX 改进(转人工动线 + 支撑项)已落。

---

## Self-Review 记录

- **Spec 覆盖**:痛点1(状态点/角标/tab/提醒卡=Task 3-6)、痛点2(工单群名跳转 Task7 + 会话动线 Task8)、痛点3(状态点 Task4)、痛点4(RelativeTime Task9-10);支撑(ThemeToggle T11、PollingIndicator T12、Empty T13、日志 T14、config T15、重启确认 T16)。全覆盖。
- **类型一致**:`useGroupNames` 返回 `{names,name,label}` 全任务统一;`Overview` 含 `openTickets/humanSessions` 在 Task1(API)/Task3(Provider)/Task6(page)一致。
- **占位符**:无 TBD/TODO,均含实际代码。
- **依赖顺序**:Task6 的 bootedAt 替换明确推迟到 Task10,避免跨批依赖 RelativeTime。
