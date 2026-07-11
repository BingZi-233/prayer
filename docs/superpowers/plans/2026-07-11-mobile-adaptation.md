# 移动端适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让全部 admin 页 + login 在移动端可用——消除横向滚动、面板重叠、点不到的控件;master-detail 页(sessions、kb)手机上单栏切换。

**Architecture:** 抽一个共享 `MasterDetail` 组件封装"手机单栏切换+返回 / 桌面双栏 grid",sessions 与 kb 共用;其余页面已由外壳与共享组件(sidebar Sheet、PageHeader、KPI flex-wrap、admin 表格 sticky+渐进列)响应式,只做 Playwright 双视口验证 + 零星补丁。

**Tech Stack:** Next.js 16, React 19, Tailwind v4, shadcn/radix, 现有 `hooks/use-mobile.ts` `useIsMobile()`(768px)。验证用 Playwright MCP。无组件单测设施(测试环境为 node,仅 lib `.ts` 用例),故验证以 typecheck + 浏览器驱动为准,不新增 jsdom/testing-library。

**Spec:** `docs/superpowers/specs/2026-07-11-mobile-adaptation-design.md`

---

## File Structure

- Create: `components/admin/master-detail.tsx` — 单一职责:按视口+选中态在双栏/单栏间取舍;纯展示容器,无数据获取。
- Modify: `app/admin/sessions/page.tsx` — 用 `MasterDetail` 包住现有列表/详情双栏(约 496 行 grid)。
- Modify: `app/admin/kb/page.tsx` — 用 `MasterDetail` 包住现有文件树/编辑器双栏(约 599 行 grid)。
- Verify only(预期零改或极小补丁):`app/admin/{page,logs,handoff,proactive,reflection,config,groups,capabilities,plugins}/page.tsx`、`app/login/page.tsx`。

---

## Task 1: MasterDetail 组件

**Files:**
- Create: `components/admin/master-detail.tsx`

- [x] **Step 1: 写组件**

参考现有组件风格(`components/admin/page-header.tsx`:`"use client"` 非必需——page-header 是 server;但本组件用 `useIsMobile` hook,必须 client)。写入 `components/admin/master-detail.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// 共享 master-detail 容器:
// - 桌面(≥breakpoint):双栏 grid [listWidth_1fr],list + detail 同时显示,等价原布局。
// - 手机(<768px):未选中只显示 list 占满;已选中显示 detail,顶部加 sticky 返回条。
// sessions / kb 共用,避免复制单栏切换逻辑。
export function MasterDetail({
  selected,
  onBack,
  list,
  detail,
  listWidth = "340px",
  backLabel = "返回",
  breakpoint = "lg",
  className,
}: {
  selected: boolean;
  onBack: () => void;
  list: ReactNode;
  detail: ReactNode;
  listWidth?: string;
  backLabel?: string;
  breakpoint?: "md" | "lg";
  className?: string;
}) {
  const isMobile = useIsMobile();

  // 手机:单栏切换。useIsMobile 首帧(hydration 前)返回 false → 走桌面双栏,安全默认不闪错单栏。
  if (isMobile) {
    if (!selected) {
      return <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>{list}</div>;
    }
    return (
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground -mx-1 mb-2 flex h-11 shrink-0 items-center gap-1 px-1 text-sm"
        >
          <ChevronLeft className="size-4" />
          {backLabel}
        </button>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{detail}</div>
      </div>
    );
  }

  // 桌面:双栏 grid。gridTemplateColumns 用行内 style 承载动态 listWidth(Tailwind 不能拼动态值)。
  return (
    <div
      className={cn(
        "grid min-h-0 min-w-0 flex-1 gap-4",
        breakpoint === "md" ? "md:grid-cols-[var(--md-cols)]" : "lg:grid-cols-[var(--md-cols)]",
        className,
      )}
      style={{ ["--md-cols" as string]: `minmax(0,${listWidth}) minmax(0,1fr)` }}
    >
      {list}
      {detail}
    </div>
  );
}
```

- [x] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 无 error(新文件类型自洽)。

- [x] **Step 3: lint**

Run: `pnpm lint`
Expected: 无 error。

- [x] **Step 4: Commit**

```bash
git add components/admin/master-detail.tsx
git commit -m "feat(admin): 加 MasterDetail 组件(手机单栏切换/桌面双栏)"
```

---

## Task 2: 接线 sessions

**Files:**
- Modify: `app/admin/sessions/page.tsx`(约 496–616 行 list SectionCard、618 起 detail SectionCard;769/770 附近 grid div 收尾)

- [x] **Step 1: 读现状定边界**

Run: `sed -n '494,500p' app/admin/sessions/page.tsx`
确认第 496 行为 `<div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_1fr]">`,其后紧跟列表 `<SectionCard>`(约 497–616)与详情 `<SectionCard>`(约 618 起),最终该 grid `</div>` 收尾。

- [x] **Step 2: import MasterDetail**

在文件顶部 import 区(`SectionCard` import 同组,约 47 行)后加:

```tsx
import { MasterDetail } from "@/components/admin/master-detail";
```

- [x] **Step 3: 替换 grid 包裹为 MasterDetail**

把:

```tsx
<div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_1fr]">
  <SectionCard title="会话列表" ...>
    ...列表...
  </SectionCard>
  <SectionCard title="会话记录" ...>
    ...详情...
  </SectionCard>
</div>
```

改为(仅替换最外层 `<div grid>` 与其闭合 `</div>`,两个 SectionCard 原样移入 `list`/`detail`):

```tsx
<MasterDetail
  selected={!!active}
  onBack={() => setActive(null)}
  listWidth="340px"
  backLabel="返回会话列表"
  list={
    <SectionCard title="会话列表" ...>
      ...列表(原样)...
    </SectionCard>
  }
  detail={
    <SectionCard title="会话记录" ...>
      ...详情(原样)...
    </SectionCard>
  }
/>
```

注意:`setActive` 是该页已有 setter(约 119 行 `const [active, setActive] = useState<string | null>(null)`)。若清空选中还需重置其他 ref/URL,沿用页内已有的"打开/关闭会话"路径——若存在 `open(null)` 或 `syncUrl(null, ...)` 之类函数,`onBack` 改调它以保持 URL/ref 一致;否则 `() => setActive(null)` 即可。执行时先 grep 确认:`grep -n "syncUrl\|setActive(null)\|function open" app/admin/sessions/page.tsx`。

- [x] **Step 4: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 无 error。

- [x] **Step 5: Playwright 验证(见 Task 5 复用同一流程,先单验 sessions)**

启动 dev(若未起):`pnpm dev`(0.0.0.0:3000)。用 Playwright MCP:
1. `browser_resize` 375×667。
2. `browser_navigate` `http://localhost:3000/admin/sessions`(如需登录先过 login)。
3. 断言无横向滚动:`browser_evaluate` `() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1` → 期望 `true`。
4. 手机下应仅见会话列表(无详情空态并列)。点一条会话 → 见记录 + 顶部"‹ 返回会话列表"。点返回 → 回列表。
5. `browser_resize` 768×1024 → 断言列表+记录双栏并存。

- [x] **Step 6: Commit**

```bash
git add app/admin/sessions/page.tsx
git commit -m "feat(sessions): 移动端单栏切换(套 MasterDetail)"
```

---

## Task 3: 接线 kb

**Files:**
- Modify: `app/admin/kb/page.tsx`(约 599 行 grid;左栏文件树 SectionCard;右栏 `{active ? <编辑器 SectionCard/> : <空态>}`)

- [x] **Step 1: 读现状定边界**

Run: `sed -n '597,601p' app/admin/kb/page.tsx`
确认第 599 行为 `<div className="grid min-h-0 min-w-0 flex-1 gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">`,其后为文件树 `<SectionCard title="文件" ...>`,再后为 `{active ? (<编辑器 SectionCard/>) : (<空态/>)}`,最终该 grid `</div>` 收尾。

- [x] **Step 2: import MasterDetail**

在 import 区加:

```tsx
import { MasterDetail } from "@/components/admin/master-detail";
```

- [x] **Step 3: 替换 grid 包裹为 MasterDetail**

把:

```tsx
<div className="grid min-h-0 min-w-0 flex-1 gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
  <SectionCard title="文件" ...>
    ...文件树...
  </SectionCard>
  {active ? (
    <SectionCard ...>...编辑器...</SectionCard>
  ) : (
    <空态 .../>
  )}
</div>
```

改为(`detail` 直接放原三元表达式;桌面下 `!active` 仍显示空态,手机下 `!active` 由 MasterDetail 直接不渲染 detail 只显示 list):

```tsx
<MasterDetail
  selected={!!active}
  onBack={() => setActive(null)}
  breakpoint="md"
  listWidth="280px"
  backLabel="返回文件列表"
  list={
    <SectionCard title="文件" ...>
      ...文件树(原样)...
    </SectionCard>
  }
  detail={
    active ? (
      <SectionCard ...>...编辑器(原样)...</SectionCard>
    ) : (
      <空态(原样) .../>
    )
  }
/>
```

注意:`setActive` 为该页已有 setter(约 164 行)。若关闭文件还需重置 `content`/`unsaved`/tab 等,`onBack` 改调页内已有的"关闭/切换文件"逻辑;执行时先 grep:`grep -n "setActive\|function open\|selectFile\|loadFile" app/admin/kb/page.tsx`,复用最贴近"清空当前文件"的路径。若无专用函数,`() => setActive(null)` 即可(未保存改动的提醒由页内既有 `unsaved` 逻辑负责,不在本任务扩展)。

- [x] **Step 4: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 无 error。

- [x] **Step 5: Playwright 验证**

375×667:导航 `/admin/kb` → 断言无横向滚动 → 仅见文件树 → 点文件 → 见编辑器 + "‹ 返回文件列表" → 返回回文件树。768×1024:双栏并存。

- [x] **Step 6: Commit**

```bash
git add app/admin/kb/page.tsx
git commit -m "feat(kb): 移动端单栏切换(套 MasterDetail)"
```

---

## Task 4: 其余页面双视口扫查 + 补丁

**Files(仅在发现问题时 Modify):**
- `app/admin/page.tsx`、`app/admin/logs/page.tsx`、`app/admin/handoff/page.tsx`、`app/admin/proactive/page.tsx`、`app/admin/reflection/page.tsx`、`app/admin/config/page.tsx`、`app/admin/groups/page.tsx`、`app/admin/capabilities/page.tsx`、`app/admin/plugins/page.tsx`、`app/login/page.tsx`

- [x] **Step 1: 逐页 375px 扫查**

dev 已起。对上述每个路由,用 Playwright MCP:
1. `browser_resize` 375×667。
2. `browser_navigate` 到该页。
3. `browser_evaluate` `() => { const el = document.documentElement; return { ok: el.scrollWidth <= el.clientWidth + 1, sw: el.scrollWidth, cw: el.clientWidth }; }`。
4. 记录 `ok=false` 的页与溢出元素(用 `browser_snapshot` 或 evaluate 找出 `scrollWidth > clientWidth` 的子节点)。

- [x] **Step 2: 对溢出页补 Tailwind 断点补丁**

已知合格基线(不动):admin 表格 `min-w-[32rem]`+外层 `overflow-auto`+`hidden sm:table-cell`;PageHeader `flex-col sm:flex-row`;KPI `flex-wrap`;plugins `sm:grid-cols-2 lg:grid-cols-4`;login `max-w-sm p-4`。

补丁原则(仅对实测溢出处):
- 宽表格 → 外层包 `<div className="overflow-x-auto">` 或列加 `hidden sm:table-cell`。
- 固定宽 `w-[NNNpx]` → 改 `w-full max-w-[NNNpx]` 或 `min-w-0`。
- 多列 grid `grid-cols-N`(N≥2 且无移动断点)→ 改 `grid-cols-1 sm:grid-cols-N`。
- 长按钮行 → 确认已有 `flex-wrap`;无则加。

每处改完 `browser_navigate` 重载复验 `ok=true`。

- [x] **Step 3: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 无 error。

- [x] **Step 4: Commit(若有改动)**

```bash
git add -A
git commit -m "fix(admin): 补移动端溢出/断点(逐页扫查)"
```

若 Step 1 全部 `ok=true` 无需补丁,跳过 commit,在执行记录中注明"其余页面 375px 无横向滚动,无需改动"。

---

## Task 5: 全站双视口终验

**Files:** 无(纯验证)

- [x] **Step 1: 375×667 全路由过一遍**

路由清单:`/login`, `/admin`, `/admin/logs`, `/admin/sessions`, `/admin/handoff`, `/admin/proactive`, `/admin/kb`, `/admin/reflection`, `/admin/config`, `/admin/groups`, `/admin/capabilities`, `/admin/plugins`。
每页 `browser_resize` 375×667 → `browser_navigate` → 断言无横向滚动。

- [x] **Step 2: master-detail 链路**

375px 下 sessions、kb 各走一遍:列表 → 点进详情 → 返回。确认返回后列表筛选/滚动状态未丢。

- [x] **Step 3: 768×1024 复验**

同清单每页 768×1024 断言无横向滚动;sessions、kb 双栏并存。

- [x] **Step 4: 交互抽查**

375px 下抽查:侧栏 Sheet 抽屉开合(点 header `SidebarTrigger`);config 页表单可填可提交;任一弹窗/对话框不溢出视口。

- [x] **Step 5: 记录结果**

在执行记录里列出每页两视口的 `ok` 结果 + master-detail 链路通过情况。全绿则完成。
