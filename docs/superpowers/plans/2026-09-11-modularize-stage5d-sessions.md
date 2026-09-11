# 模块化分层重构 · 阶段 5d（拆 sessions 页）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `app/admin/sessions/page.tsx`（1072 行）拆成区块组件 + 一个核心状态 hook，页面本身降到约 200 行。

**Architecture:** 沿用 5c 确立的受控组件 + 同目录 hook 模式。**本页是最硬的**：八个 ref（`activeKeyRef`、`activeUpdatedAtRef`、`sessionsRef`、`mountedRef`、`filterRef`、`transcriptGenRef`、`lastHandledUrlKeyRef`、`writingUrlKeyRef`）跨 `openSession` ↔ effect ↔ poller 共享，且 URL 同步与三个 effect、`refresh` 是一体的竞态治理。**它们必须整体进同一个 hook，拆两半即坏。** 独立的 fetch 动作（resetAll / resetOne / resumeHandoff / copyText）与对话框状态（resetting / resuming / confirmStep / resetKey）不参与竞态，留在页面。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5.9、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（「阶段 5」第 3 条）

## Global Constraints

- **行为不变。** 纯重组：渲染结果、异步时序、事件处理、竞态治理一律不变。**唯一允许的改动是搬位置、改 import、引入新 props 签名。**
- **分层硬约束：** 拆出的组件放进 `components/`，**只可 import `components/*` 与 `lib/core/*`**。**实测 sessions 页目前 import 了 `@/lib/core/*`（utils、group-name、channel-labels）与 `@/components/*`，没越界。** 拆分后全部新文件也必须守在这条线内。`createSessionListCoordinator`/`postSessionAction` 来自 `@/components/admin/session-polling`（components 内），合法。
- **隔离检出：** 本阶段实现者在独立 git worktree 里工作。主检出供 controller 用。
- **分支**：`refactor/stage5d-sessions`。不 push。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**；不要对不合 prettier 的文件跑 `--write`。

## 当前结构（实施前自己复核，行号会漂）

```
  1– 76   import + "use client"
 78– 99   ChannelBadge 组件（渠道徽章）
101–118   Sess / Msg 类型
120       Filter 类型
122       POLL_MS 常量
124–130   clock(ts)
132–139   hangLabel(since)
141–144   isCustomerRole(role)
146–152   SessionsPage（Suspense 包装）
154–164   SessionsSkeleton
166–1072  SessionsInner（主逻辑 + JSX）
  166–208   状态 + 八个 ref
  207–223   useGroupNames/useMemberNames + keyLabel
  225–239   syncUrl
  241–268   loadTranscript
  270–297   openSession
  299–304   closeSession
  306–329   refreshActiveTranscript
  330–348   sessionCoordinator(useMemo)
  349–369   参数 effect（URL key 变化）
  371–386   列表就绪 effect（深链补开）
  388–397   poller effect
  399–416   refresh
  418–422   setFilterAndUrl
  424–435   confirmSteps
  437–454   resetAll
  456–470   resetOne
  472–488   resumeHandoff
  490–497   copyText
  499–555   派生（activeSess/stats/list/shown/visibleMsgs/toolCount/lastBotText/filters）
  557–1071  JSX（PageShell/PageHeader + MasterDetail + 两个 AlertDialog）
```

## 目标结构

```
components/admin/sessions/
  types.ts                  # Sess / Msg / Filter
  utils.ts                  # clock / hangLabel / isCustomerRole
  channel-badge.tsx         # ChannelBadge
  session-list.tsx          # SessionList —— 列表（受控）
  transcript-view.tsx       # TranscriptView —— 对话记录（受控）
  session-dialogs.tsx       # SessionDialogs —— 两个 AlertDialog（受控）
  use-session-selection.ts  # 核心状态 hook（八个 ref + openSession + effect + poller）
app/admin/sessions/page.tsx # 只做编排 + resetAll/resetOne/resumeHandoff/copyText 四个 fetch
```

**为什么 `loadSessions` 要从 hook 返回：** 页面的 `resetAll`/`resetOne`/`resumeHandoff` 调 `postSessionAction(…, loadSessions)`，而 `loadSessions` 来自 hook 里的 `sessionCoordinator`。hook 把它返给页面，避免页面反向 import hook 内部实现。

## Task 1: 抽 types.ts + utils.ts + channel-badge.tsx

**Files:**
- Create: `components/admin/sessions/types.ts`、`utils.ts`、`channel-badge.tsx`
- Modify: `app/admin/sessions/page.tsx`

- [ ] **Step 0: 隔离环境准备**

worktree 里没有 `node_modules`，符号链接过来（静态验证够用；真机验证阶段再按 Task 5 Step 0 换成真实依赖）：

```bash
ln -s /Users/ziyou/projects/prayer/node_modules node_modules
pnpm vitest run tests/lib/core/format-duration.test.ts   # 冒烟
```

若符号链接后 Turbopack 起 dev 报 `Symlink [project]/node_modules is invalid`，按 Task 5 Step 0 删链接、`CI=true pnpm install`。

- [ ] **Step 1: 抽 `types.ts`**

把 L101–118 的 `Sess`/`Msg` 与 L120 的 `Filter` 原样搬进 `types.ts`，加 export：

```ts
export interface Sess {
  key: string
  sessionId: string | null
  active: boolean
  humanMode?: boolean
  humanSince?: number | null
  lastQuestion: string | null
  updatedAt: number
}

export interface Msg {
  role: string
  text?: string
  tool?: string
  input?: string
  result?: string
  ts?: number
  model?: string
}

export type Filter = "all" | "active" | "human"
```

- [ ] **Step 2: 抽 `utils.ts`**

把 L124–144 的 `clock`/`hangLabel`/`isCustomerRole` 原样搬进 `utils.ts`，加 export：

```ts
export function clock(ts: number | undefined): string {
  if (!ts) return ""
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function hangLabel(since: number | null | undefined): string | null {
  if (!since) return null
  const min = Math.max(0, Math.round((Date.now() - since) / 60_000))
  if (min < 1) return "刚转人工"
  if (min < 60) return `挂起 ${min} 分`
  const h = Math.floor(min / 60)
  return `挂起 ${h} 时 ${min % 60} 分`
}

/** 仅客户(user)靠左,其余(bot / tool / …)一律靠右 */
export function isCustomerRole(role: string): boolean {
  return role === "user"
}
```

- [ ] **Step 3: 抽 `channel-badge.tsx`**

把 L78–99 的 `ChannelBadge` 原样搬进 `channel-badge.tsx`：

```tsx
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/core/utils"
import { sessionKeyParts } from "@/lib/core/chat/group-name"
import { channelLabel } from "@/lib/core/chat/channel-labels"

/** 从来源 session key 解析渠道，展示为小徽章 */
export function ChannelBadge({
  sessionKey,
  className,
}: {
  sessionKey: string
  className?: string
}) {
  const channel = sessionKeyParts(sessionKey)?.channel ?? "qq"
  const label = channelLabel(channel)
  return (
    <Badge
      variant="secondary"
      className={cn(
        "h-4 shrink-0 border-transparent bg-foreground px-1 text-[10px] text-background",
        className
      )}
      title={`来源渠道: ${label}`}
    >
      {label}
    </Badge>
  )
}
```

- [ ] **Step 4: 页面改为 import**

`app/admin/sessions/page.tsx` 删掉 L78–99（ChannelBadge）、L101–120（Sess/Msg/Filter）、L124–144（clock/hangLabel/isCustomerRole）的定义，改成：

```ts
import type { Sess, Msg, Filter } from "@/components/admin/sessions/types"
import { clock, hangLabel, isCustomerRole } from "@/components/admin/sessions/utils"
import { ChannelBadge } from "@/components/admin/sessions/channel-badge"
```

**注意**：`clock`/`hangLabel`/`isCustomerRole` 本阶段页面里还在用（JSX 尚未抽走），保留这些 import；`channelLabel`/`sessionKeyParts`/`cn` 若只剩 ChannelBadge 用，页面删掉对应 import（逐个确认）。

- [ ] **Step 5: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；975 用例全过（契约测试此时还不会红 —— 页面里仍有 `<MasterDetail`、`syncUrl(`、`createSessionListCoordinator`、`preventBaseUIHandler`）。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(admin): sessions 页的类型、纯函数与渠道徽章外提

Sess/Msg/Filter 类型、clock/hangLabel/isCustomerRole 纯函数、
ChannelBadge 徽章组件,页面与后续区块组件共用,按 5c 模式放进
components/admin/sessions/。代码原样搬移,只改 import。"
```

## Task 2: 抽 use-session-selection.ts

**Files:**
- Create: `components/admin/sessions/use-session-selection.ts`
- Modify: `app/admin/sessions/page.tsx`

**摩擦点（本 Task 核心）：** 八个 ref 与 `openSession`/`loadTranscript`/`refreshActiveTranscript`/`syncUrl`/`sessionCoordinator`/三个 effect 是一体。**必须整段搬进 hook，一个都不能拆开。** 页面留下 `resetting`/`resuming`/`confirmStep`/`resetKey` 四个状态与 `resetAll`/`resetOne`/`resumeHandoff`/`copyText`/`confirmSteps`。

- [ ] **Step 1: 写 hook**

创建 `use-session-selection.ts`。**代码原样搬** L166–422（状态 + 八个 ref + keyLabel + syncUrl + loadTranscript + openSession + closeSession + refreshActiveTranscript + sessionCoordinator + 三个 effect + refresh + setFilterAndUrl）与 L499–555（派生），只做「去掉 resetting/resuming/confirmStep/resetKey 四个状态」与「返回对象」。`POLL_MS` 一并搬进本文件（只被 sessionCoordinator 用）。

完整实现（**逐字搬，勿改逻辑**）：

```ts
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { createSessionListCoordinator } from "@/components/admin/session-polling"
import { useGroupNames, useMemberNames } from "@/lib/core/chat/group-name"
import type { Sess, Msg, Filter } from "./types"

const POLL_MS = 4000

export function useSessionSelection() {
  const router = useRouter()
  const params = useSearchParams()
  const [sessions, setSessions] = useState<Sess[] | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState<Filter>(() => {
    if (params.get("human") === "1") return "human"
    if (params.get("active") === "1") return "active"
    return "all"
  })
  const [showTools, setShowTools] = useState(false)

  const activeKeyRef = useRef<string | null>(null)
  const activeUpdatedAtRef = useRef<number | null>(null)
  const sessionsRef = useRef<Sess[] | null>(null)
  const mountedRef = useRef(false)
  const isMounted = useCallback(() => mountedRef.current, [])
  const commitSessions = useCallback((next: Sess[] | null) => {
    if (next) {
      sessionsRef.current = next
      setSessions(next)
    }
  }, [])
  const filterRef = useRef(filter)
  const transcriptGenRef = useRef(0)
  const lastHandledUrlKeyRef = useRef<string | null | undefined>(undefined)
  const writingUrlKeyRef = useRef<string | null>(null)

  const { label } = useGroupNames()
  const memberName = useMemberNames((sessions ?? []).map((s) => s.key))

  const keyLabel = useCallback(
    (key: string) => {
      const base = label(key)
      const nick = memberName(key)
      if (!nick) return base
      const sep = " · "
      const i = base.lastIndexOf(sep)
      if (i < 0) return `${base}${sep}${nick}`
      return `${base.slice(0, i)}${sep}${nick}`
    },
    [memberName, label]
  )

  const syncUrl = useCallback(
    (key: string | null, nextFilter: Filter) => {
      writingUrlKeyRef.current = key
      lastHandledUrlKeyRef.current = key
      const sp = new URLSearchParams()
      if (key) sp.set("key", key)
      if (nextFilter === "human") sp.set("human", "1")
      if (nextFilter === "active") sp.set("active", "1")
      const q = sp.toString()
      router.replace(q ? `/admin/sessions?${q}` : "/admin/sessions", {
        scroll: false,
      })
    },
    [router]
  )

  const loadTranscript = useCallback(
    async (sessionId: string, gen: number, forKey: string) => {
      try {
        const r = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}`
        ).then((x) => x.json())
        if (transcriptGenRef.current !== gen || activeKeyRef.current !== forKey)
          return
        if (r.ok && mountedRef.current) setMsgs(r.data as Msg[])
      } catch {
        /* 保持旧 msgs 或空 */
      } finally {
        if (
          transcriptGenRef.current === gen &&
          activeKeyRef.current === forKey
        ) {
          if (mountedRef.current) setLoading(false)
        }
      }
    },
    []
  )

  const openSession = useCallback(
    (sess: Sess, opts: { pushUrl?: boolean; forceReload?: boolean } = {}) => {
      const { pushUrl = true, forceReload = false } = opts
      if (!sess.sessionId) {
        toast.message("无对话记录", {
          description: "该会话尚无对话记录（可能刚创建或已过期）。",
        })
        return
      }
      if (!forceReload && activeKeyRef.current === sess.key) {
        if (pushUrl) syncUrl(sess.key, filterRef.current)
        return
      }
      activeKeyRef.current = sess.key
      activeUpdatedAtRef.current = sess.updatedAt
      setActive(sess.key)
      if (pushUrl) syncUrl(sess.key, filterRef.current)
      const gen = ++transcriptGenRef.current
      setLoading(true)
      setMsgs([])
      void loadTranscript(sess.sessionId, gen, sess.key)
    },
    [loadTranscript, syncUrl]
  )

  const closeSession = useCallback(() => {
    activeKeyRef.current = null
    setActive(null)
    syncUrl(null, filterRef.current)
  }, [syncUrl])

  const refreshActiveTranscript = useCallback(async (list: Sess[] | null) => {
    try {
      if (!list || !mountedRef.current) return
      const key = activeKeyRef.current
      if (!key) return
      const s = list.find((x) => x.key === key)
      if (!s?.sessionId || activeUpdatedAtRef.current === s.updatedAt) return
      activeUpdatedAtRef.current = s.updatedAt
      const gen = ++transcriptGenRef.current
      const tr = await fetch(
        `/api/sessions/${encodeURIComponent(s.sessionId)}`
      ).then((x) => x.json())
      if (
        mountedRef.current &&
        transcriptGenRef.current === gen &&
        activeKeyRef.current === key &&
        tr.ok
      ) {
        setMsgs(tr.data as Msg[])
      }
    } catch {
      /* 静默 */
    }
  }, [])

  /* eslint-disable react-hooks/refs */
  const sessionCoordinator = useMemo(
    () =>
      createSessionListCoordinator(
        async (): Promise<Sess[] | null> => {
          const r = await fetch("/api/sessions").then((x) => x.json())
          if (r.ok) return r.data as Sess[]
          return null
        },
        isMounted,
        commitSessions,
        { intervalMs: POLL_MS },
        refreshActiveTranscript
      ),
    [commitSessions, isMounted, refreshActiveTranscript]
  )
  /* eslint-enable react-hooks/refs */
  const loadSessions = sessionCoordinator.loadSessions

  const paramKey = params.get("key")
  useEffect(() => {
    if (writingUrlKeyRef.current != null) {
      if (paramKey === writingUrlKeyRef.current) {
        writingUrlKeyRef.current = null
      }
      return
    }
    if (paramKey === lastHandledUrlKeyRef.current) return
    lastHandledUrlKeyRef.current = paramKey
    if (!paramKey) return
    if (activeKeyRef.current === paramKey) return
    const list = sessionsRef.current
    if (!list) return
    const s = list.find((x) => x.key === paramKey)
    if (s) openSession(s, { pushUrl: false })
  }, [paramKey, openSession])

  useEffect(() => {
    if (!sessions?.length) return
    if (writingUrlKeyRef.current != null) return
    const key = paramKey
    if (!key) return
    if (activeKeyRef.current === key) return
    if (lastHandledUrlKeyRef.current === key && activeKeyRef.current) return
    const s = sessions.find((x) => x.key === key)
    if (s) {
      lastHandledUrlKeyRef.current = key
      openSession(s, { pushUrl: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  useEffect(() => {
    mountedRef.current = true
    const poller = sessionCoordinator.poller
    poller.start()
    return () => {
      mountedRef.current = false
      poller.stop()
    }
  }, [sessionCoordinator])

  async function refresh() {
    setRefreshing(true)
    try {
      const list = await loadSessions()
      const key = activeKeyRef.current
      if (key && list) {
        const s = list.find((x) => x.key === key)
        if (s?.sessionId) {
          activeUpdatedAtRef.current = s.updatedAt
          const gen = ++transcriptGenRef.current
          setLoading(true)
          await loadTranscript(s.sessionId, gen, key)
        }
      }
    } finally {
      setRefreshing(false)
    }
  }

  function setFilterAndUrl(f: Filter) {
    setFilter(f)
    filterRef.current = f
    syncUrl(activeKeyRef.current, f)
  }

  const activeSess = useMemo(
    () => (sessions ?? []).find((s) => s.key === active) ?? null,
    [sessions, active]
  )

  const stats = useMemo(() => {
    const all = sessions ?? []
    return {
      total: all.length,
      active: all.filter((s) => s.active).length,
      human: all.filter((s) => s.humanMode).length,
    }
  }, [sessions])

  const list = useMemo(() => {
    let base = sessions ?? []
    if (filter === "human") base = base.filter((s) => s.humanMode)
    else if (filter === "active") base = base.filter((s) => s.active)
    return [...base].sort((a, b) => {
      if (!!b.humanMode !== !!a.humanMode) return a.humanMode ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [sessions, filter])

  const shown = useMemo(() => {
    if (!deferredQuery.trim()) return list
    const q = deferredQuery.toLowerCase()
    return list.filter(
      (s) =>
        s.key.toLowerCase().includes(q) ||
        keyLabel(s.key).toLowerCase().includes(q) ||
        (s.lastQuestion ?? "").toLowerCase().includes(q)
    )
  }, [list, deferredQuery, keyLabel])

  const visibleMsgs = useMemo(
    () => (showTools ? msgs : msgs.filter((m) => m.role !== "tool")),
    [msgs, showTools]
  )

  const toolCount = useMemo(
    () => msgs.filter((m) => m.role === "tool").length,
    [msgs]
  )

  const lastBotText = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && msgs[i].text) return msgs[i].text!
    }
    return null
  }, [msgs])

  return {
    sessions,
    msgs,
    active,
    loading,
    refreshing,
    query,
    setQuery,
    filter,
    showTools,
    setShowTools,
    openSession,
    closeSession,
    refresh,
    setFilterAndUrl,
    activeSess,
    stats,
    list,
    shown,
    visibleMsgs,
    toolCount,
    lastBotText,
    keyLabel,
    loadSessions,
  }
}
```

- [ ] **Step 2: 页面改用 hook**

`app/admin/sessions/page.tsx` 的 `SessionsInner` 删掉 L167–422（状态 + ref + keyLabel + syncUrl + loadTranscript + openSession + closeSession + refreshActiveTranscript + sessionCoordinator + 三个 effect + refresh + setFilterAndUrl）与 L499–555（派生），改成：

```ts
const sel = useSessionSelection()
```

页面里对 `sessions`/`msgs`/`active`/`loading`/`refreshing`/`query`/`setQuery`/`filter`/`showTools`/`setShowTools`/`openSession`/`closeSession`/`refresh`/`setFilterAndUrl`/`activeSess`/`stats`/`list`/`shown`/`visibleMsgs`/`toolCount`/`lastBotText`/`keyLabel` 的引用全部改成 `sel.xxx`。

页面保留 `resetting`/`resuming`/`confirmStep`/`resetKey` 状态与 `resetAll`/`resetOne`/`resumeHandoff`/`copyText`/`confirmSteps`。`resetAll`/`resetOne`/`resumeHandoff` 里的 `loadSessions` 改为 `sel.loadSessions`。

> **本 Task 结束时页面仍能编译、能跑。** JSX 尚未抽走，只是所有状态/动作/派生改从 `sel` 取。

- [ ] **Step 3: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；975 用例全过。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(admin): sessions 页的选中状态与竞态治理收进 use-session-selection

八个 ref 跨 openSession ↔ effect ↔ poller 共享,与 URL 同步、三个 effect、
refresh 是一体的竞态治理,整体进一个 hook。页面留 resetAll/resetOne/
resumeHandoff/copyText 四个 fetch 动作与对话框状态。"
```

## Task 3: 抽 session-list.tsx + transcript-view.tsx + session-dialogs.tsx

**Files:**
- Create: `components/admin/sessions/session-list.tsx`、`transcript-view.tsx`、`session-dialogs.tsx`
- Modify: `app/admin/sessions/page.tsx`

三个区块互相独立，做成受控组件。**JSX 原样搬，只改回调。**

- [ ] **Step 1: 抽 `session-list.tsx`**

把 L599–742 的 `list`（`SectionCard` 整段，含标题/描述/filters/搜索/DataState/VirtualList）搬进 `session-list.tsx`。**改动：** `openSession(sess)` → `onOpen(sess)`、`setResetKey(sess.key)` → `onResetOne(sess.key)`。`filters` 数组（原 L551–555）在本文件内用 `stats` 构造。

```tsx
import { MessagesSquare, Search, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { SectionCard } from "@/components/admin/section-card"
import { VirtualList } from "@/components/admin/virtual-list"
import { DataState } from "@/components/admin/data-state"
import { RelativeTime } from "@/components/relative-time"
import { cn } from "@/lib/core/utils"
import { ChannelBadge } from "./channel-badge"
import { hangLabel } from "./utils"
import type { Sess, Filter } from "./types"
import { Circle, UserRound } from "lucide-react"

interface SessionListProps {
  shown: Sess[]
  list: Sess[]
  stats: { total: number; active: number; human: number }
  filter: Filter
  query: string
  setQuery: (q: string) => void
  setFilterAndUrl: (f: Filter) => void
  active: string | null
  keyLabel: (key: string) => string
  onOpen: (sess: Sess) => void
  onResetOne: (key: string) => void
}

export function SessionList({
  shown,
  list,
  stats,
  filter,
  query,
  setQuery,
  setFilterAndUrl,
  active,
  keyLabel,
  onOpen,
  onResetOne,
}: SessionListProps) {
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: stats.total },
    { id: "active", label: "活跃", count: stats.active },
    { id: "human", label: "人工", count: stats.human },
  ]
  return (
    <SectionCard
      title="会话列表"
      description={`${shown.length} / ${list.length} · 活跃 ${stats.active} · 人工 ${stats.human}`}
      className="flex min-h-0 flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col gap-2"
    >
      {/* 原 L606–741 的 filters 按钮 + 搜索框 + DataState/VirtualList 原样搬入,
          仅 openSession→onOpen、setResetKey→onResetOne */}
    </SectionCard>
  )
}
```

- [ ] **Step 2: 抽 `transcript-view.tsx`**

把 L744–1000 的 `detail`（`SectionCard` 整段，含标题/action 按钮/EmptyState/DataState/MessageScroller）搬进 `transcript-view.tsx`。**改动：** `resumeHandoff(activeSess.key)` → `onResumeHandoff(activeSess.key)`、`copyText(...)` → `onCopyText(...)`、`setResetKey(activeSess.key)` → `onResetOne(activeSess.key)`。

```tsx
import type { Dispatch, SetStateAction } from "react"
import {
  MessagesSquare, Wrench, Copy, UserRound, Eye, EyeOff, LifeBuoy, RotateCcw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { SectionCard } from "@/components/admin/section-card"
import { DataState, EmptyState } from "@/components/admin/data-state"
import { cn } from "@/lib/core/utils"
import { ChannelBadge } from "./channel-badge"
import { clock, isCustomerRole } from "./utils"
import type { Sess, Msg } from "./types"

interface TranscriptViewProps {
  active: string | null
  activeSess: Sess | null
  keyLabel: (key: string) => string
  loading: boolean
  msgs: Msg[]
  visibleMsgs: Msg[]
  toolCount: number
  showTools: boolean
  setShowTools: Dispatch<SetStateAction<boolean>>
  lastBotText: string | null
  resuming: boolean
  onResumeHandoff: (key: string) => void
  onCopyText: (text: string) => void
  onResetOne: (key: string) => void
}

export function TranscriptView({
  active,
  activeSess,
  keyLabel,
  loading,
  msgs,
  visibleMsgs,
  toolCount,
  showTools,
  setShowTools,
  lastBotText,
  resuming,
  onResumeHandoff,
  onCopyText,
  onResetOne,
}: TranscriptViewProps) {
  return (
    <SectionCard
      title={/* 原 L746–775 的标题 JSX 原样搬 */}
      description={/* 原 L776–782 */}
      className="flex min-h-0 flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col p-0"
      action={/* 原 L785–840 的 action 按钮组,仅 resumeHandoff→onResumeHandoff、copyText→onCopyText、setResetKey→onResetOne */}
    >
      {/* 原 L842–999 的 EmptyState/DataState/MessageScroller 原样搬入,
          仅 copyText→onCopyText */}
    </SectionCard>
  )
}
```

**注意** `transcript-view.tsx` 的 import 里不要保留 `useState`（组件本身无本地状态，`showTools` 由 props 传入）；`setShowTools` 类型用 `Dispatch<SetStateAction<boolean>>` 以兼容原 `setShowTools((v) => !v)` 的写法。

- [ ] **Step 3: 抽 `session-dialogs.tsx`**

把 L1004–1069 的两个 `AlertDialog`（重开单个 + 全部重开确认）搬进 `session-dialogs.tsx`。**改动：** `resetOne(resetKey)` → `onResetOne(resetKey)`、`resetAll()` → `onResetAll()`。`confirmSteps` 数组（原 L424–435）搬进本文件，`sessions?.length` 改为 `sessionsCount`。

```tsx
import { TriangleAlert } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface SessionDialogsProps {
  resetKey: string | null
  setResetKey: (k: string | null) => void
  confirmStep: number
  setConfirmStep: (n: number) => void
  keyLabel: (key: string) => string
  sessionsCount: number
  onResetOne: (key: string) => void
  onResetAll: () => void
}

export function SessionDialogs({
  resetKey,
  setResetKey,
  confirmStep,
  setConfirmStep,
  keyLabel,
  sessionsCount,
  onResetOne,
  onResetAll,
}: SessionDialogsProps) {
  const confirmSteps = [
    {
      title: `重开全部 ${sessionsCount} 个会话？`,
      desc: "每个会话的下一条消息将开启全新对话，历史记录仍可查看。",
      cta: "继续",
    },
    {
      title: "最后确认",
      desc: "此操作立即生效且不可撤销，机器人将丢失当前对话记忆。",
      cta: "执行全部重开",
    },
  ]
  return (
    <>
      {/* 原 L1004–1029 的 AlertDialog(重开单个) 原样搬,仅 resetOne(resetKey)→onResetOne(resetKey) */}
      {/* 原 L1031–1069 的 AlertDialog(全部重开确认) 原样搬,仅 resetAll()→onResetAll()。
          多步确认的 e.preventDefault() + e.preventBaseUIHandler() 必须原样保留。 */}
    </>
  )
}
```

- [ ] **Step 4: 页面改为 import 这三个区块**

`app/admin/sessions/page.tsx` 删掉 L599–742（list）、L744–1000（detail）、L1004–1069（两个 AlertDialog）三段 JSX，改成：

```tsx
<MasterDetail
  selected={!!sel.active}
  onBack={sel.closeSession}
  listWidth="340px"
  backLabel="返回会话列表"
  className="min-h-0 flex-1"
  list={
    <SessionList
      shown={sel.shown}
      list={sel.list}
      stats={sel.stats}
      filter={sel.filter}
      query={sel.query}
      setQuery={sel.setQuery}
      setFilterAndUrl={sel.setFilterAndUrl}
      active={sel.active}
      keyLabel={sel.keyLabel}
      onOpen={sel.openSession}
      onResetOne={setResetKey}
    />
  }
  detail={
    <TranscriptView
      active={sel.active}
      activeSess={sel.activeSess}
      keyLabel={sel.keyLabel}
      loading={sel.loading}
      msgs={sel.msgs}
      visibleMsgs={sel.visibleMsgs}
      toolCount={sel.toolCount}
      showTools={sel.showTools}
      setShowTools={sel.setShowTools}
      lastBotText={sel.lastBotText}
      resuming={resuming}
      onResumeHandoff={resumeHandoff}
      onCopyText={copyText}
      onResetOne={setResetKey}
    />
  }
/>

<SessionDialogs
  resetKey={resetKey}
  setResetKey={setResetKey}
  confirmStep={confirmStep}
  setConfirmStep={setConfirmStep}
  keyLabel={sel.keyLabel}
  sessionsCount={sel.sessions?.length ?? 0}
  onResetOne={resetOne}
  onResetAll={resetAll}
/>
```

删掉页面里不再直接引用的 import（`MessagesSquare`/`RefreshCw`/`Wrench`/`RotateCcw`/`TriangleAlert`/`Circle`/`Copy`/`UserRound`/`X`/`Eye`/`EyeOff`/`LifeBuoy`/`Search`/`Spinner`/`Skeleton`/`Bubble*`/`MessageScroller*`/`Badge`/`InputGroup*`/`AlertDialog*`/`SectionCard`/`VirtualList`/`MasterDetail`/`DataState`/`EmptyState`/`RelativeTime` 等，**逐个确认**哪些还留在页面）。**保留**：`PageShell`/`PageHeader`/`MasterDetail`/`Suspense`/`Button`（PageHeader 的 actions）/`Spinner`（PageHeader actions 里全部重开/刷新的 loading）等仍在页面用的。

- [ ] **Step 5: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run tests/architecture/layering.test.ts
pnpm vitest run
```

Expected: typecheck 无输出；layering 护栏 9 绿；**但 `tests/ui/dialog-migration-contracts.test.ts` 的「keeps the sessions multi-step action open until the final step」与 `tests/ui/admin-operations-contracts.test.ts` 的「preserves the sessions workbench layout and handoff semantics」会红**（`preventBaseUIHandler`/`syncUrl(`/`createSessionListCoordinator` 已搬出页面）—— 预期，Task 4 修。

**并自查**新组件 import 没越出 `components/*` 与 `lib/core/*`：

```bash
grep -n "^import" components/admin/sessions/*.tsx components/admin/sessions/*.ts
```

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(admin): 拆出 sessions 页的列表、对话视图与对话框

SessionList / TranscriptView / SessionDialogs 做成受控组件,状态仍在
use-session-selection hook 与页面。代码原样搬移,只改回调与 import。"
```

## Task 4: 修契约测试

**Files:**
- Modify: `tests/ui/dialog-migration-contracts.test.ts`、`tests/ui/admin-operations-contracts.test.ts`

> **⚠️ 会打破两条契约测试（Task 3 抽组件后必红）。** 断言对象是「这套语义仍在」，不是「必须写在某个文件里」。修法是把新文件加进读取列表，**不要**为了让测试过而把逻辑留在页面，**也不要**删断言。

- [ ] **Step 1: 修 `dialog-migration-contracts.test.ts`**

用例「keeps the sessions multi-step action open until the final step」（L42–48）断言的 `e.preventDefault() + e.preventBaseUIHandler()` 搬进了 `session-dialogs.tsx`。修法：

```ts
it("keeps the sessions multi-step action open until the final step", async () => {
  const [page, dialogs] = await Promise.all([
    readFile("app/admin/sessions/page.tsx", "utf8"),
    readFile("components/admin/sessions/session-dialogs.tsx", "utf8"),
  ])
  const source = page + "\n" + dialogs

  expect(source).toMatch(/e\.preventDefault\(\)\s+e\.preventBaseUIHandler\(\)/)
})
```

- [ ] **Step 2: 修 `admin-operations-contracts.test.ts`**

用例「preserves the sessions workbench layout and handoff semantics」（L27–37）断言的 6 条里，`syncUrl(` 与 `createSessionListCoordinator` 搬进了 `use-session-selection.ts`，其余四条（`<MasterDetail`/`backLabel`/`resume_handoff`/`reset_all`）仍在页面。修法加 hook 到读取列表：

```ts
it("preserves the sessions workbench layout and handoff semantics", async () => {
  const [page, hook] = await Promise.all([
    read("app/admin/sessions/page.tsx"),
    read("components/admin/sessions/use-session-selection.ts"),
  ])
  const source = page + "\n" + hook

  expect(source).toContain("<MasterDetail")
  expect(source).toContain('backLabel="返回会话列表"')
  expect(source).toContain('"resume_handoff"')
  expect(source).toContain('"reset_all"')
  expect(source).toContain("syncUrl(")
  expect(source).toContain("createSessionListCoordinator")
})
```

- [ ] **Step 3: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: typecheck 无输出；975 用例全过；layering 护栏 9 绿。

- [ ] **Step 4: 确认页面行数**

```bash
wc -l app/admin/sessions/page.tsx
```

Expected: 约 200 行。**若仍在 300 行以上，说明还有东西没搬出去** —— 回报里说明是哪些、为什么留着。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "test(ui): sessions 页拆分后契约测试改读新 hook 与组件

多步确认语义搬进 session-dialogs.tsx,syncUrl/coordinator 搬进
use-session-selection.ts,测试改同时读页面与对应新文件。"
```

## Task 5: 真机验证（本阶段特有）

**为什么必须做：** 这是最硬的一个页 —— 八个 ref 的竞态治理、URL 深链、轮询、多步确认，拆分若伤到任何一处，都是静默的行为退化。

- [ ] **Step 0: 若 worktree 里 Turbopack 因符号链接 node_modules 报错**

删符号链接、本地装真实依赖：

```bash
unlink node_modules
CI=true pnpm install
```

- [ ] **Step 1: 按仓库隔离配方起实例**

```bash
mkdir -p /tmp/verify-5d
DB_PATH=/tmp/verify-5d/agent.db \
CLAUDE_CONFIG_DIR=/tmp/verify-5d/claude-config \
ONEBOT_WS_URL= \
TELEGRAM_ENABLED_CHATS= \
TELEGRAM_BOT_TOKEN= \
ADMIN_GROUP_ID= \
KB_PREFETCH_ENABLED=false \
NEXT_DIST_DIR=.next-verify \
pnpm dev
```

核对 env 确实是这套配置要用的（读 `lib/core/config/env.ts` 的 `seedFromEnv`）；确保「不让任何真实客服应答发生」。

- [ ] **Step 2: 造数据**

sessions 页读 `/api/sessions`（来自 `sessions` 表）。空库无会话。**直接向 `sessions` 表插几条**（表结构见 `lib/core/db/migrations/schema.ts` 的 `sessions`，列含 `key`/`session_id`/`human_mode`/`last_question`/`updated_at` 等）。插 2–3 条：一条带 `session_id` 的正常会话、一条 `human_mode=1` 的人工会话、一条无 `session_id`（用于「无对话记录」提示）。

**关键**：`/api/sessions/[id]` 读对话记录（transcript），若要验证对话视图，还需往对应 session 的消息存储插消息（视 `sessions` 详情 API 的数据来源而定，读 `app/api/sessions/[id]/route.ts` 确认）。**若造消息成本过高，退而求其次：验证列表渲染 + 深链选中 + 空对话记录（「暂无对话记录」空态），并在回报里说明未覆盖真实 transcript 渲染。**

- [ ] **Step 3: 用浏览器打开 `/admin/sessions` 逐项核对**

- 页面正常渲染，左侧列表显示插入的会话（人工会话带红色「人工」徽章、`border-l-destructive`）
- 点某会话 → 右侧详情切换、URL 变为 `?key=…`、loading 态出现
- 筛选（全部/活跃/人工）切换 → 列表过滤 + URL 带 `human=1`/`active=1`
- 搜索框输入 → 列表过滤
- 带 `?key=…` 的 URL 直接打开 → 深链自动选中该会话
- 点「重开」→ 单个重开 AlertDialog 弹出，点「重开」有 toast
- 点「全部重开」→ 两步确认（第一步「继续」→ 第二步「执行全部重开」），第二步才执行
- 人工会话右侧「恢复自动答」按钮可点、有 loading/toast
- 轮询（4s）不把当前选中态/展开态冲掉

**若无法起服务或无法开浏览器，如实报告，不要跳过这项就说完成。**

- [ ] **Step 4: 记录结果**

把实际观察到的现象写进回报（**截图更好**）。任何与拆分前不一致的现象都要报。

- [ ] **Step 5: 清理**

```bash
rm -rf /tmp/verify-5d
```

## Task 6: 收口

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

- [ ] **Step 2: 清理 worktree**

主检出里执行：

```bash
cd /Users/ziyou/projects/prayer
git worktree remove .claude/worktrees/stage5d
```

（合回 main 之后。）

- [ ] **Step 3: 工作区干净**

```bash
git status --short
```

## 给 5e 的注意事项

1. **本阶段确立的手法**（受控区块组件 + 核心 hook 整体承接竞态 + 类型/纯函数单独文件）照做。
2. **kb 页有「渲染期调整 state」（L236–250、L289–306）与 ⌘/Ctrl+S 的 eslint-disable effect（L264–274）**，外提时原样搬、不得顺手改成 effect、连同注释与 eslint-disable 一起搬。
3. **kb 页产出**：`kb/{tree.ts,markdown-body.tsx,file-tree.tsx,editor-panel.tsx,file-dialogs.tsx}` + `use-kb-files.ts`（约 250 行）。
4. **契约测试**：kb 页也可能有读源码用例，拆前先 grep `read("app/admin/kb/page.tsx")` 找出会红的用例。
5. **`components/` 只可依赖 `core`** —— kb 页拆前先确认其 import 没越过这条线（若越界，停下来问 controller）。
