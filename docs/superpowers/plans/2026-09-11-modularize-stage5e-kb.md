# 模块化分层重构 · 阶段 5e（拆 kb 页）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `app/admin/kb/page.tsx`（1052 行）拆成区块组件 + 一个核心状态 hook，页面本身降到约 150 行。

**Architecture:** 沿用 5c/5d 确立的受控组件 + 同目录 hook 模式。本页有两处**「渲染期调整 state」**的写法（L235–250 与 L288–306，刻意绕 lint 的同步 setState，替代 effect 内同步 setState）与一个带 `eslint-disable` 的 ⌘/Ctrl+S effect（L263–274，依赖 `content`）。**这三处必须逐字原样搬进 hook，不得顺手改成 effect、不得删注释。**

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5.9、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（「阶段 5」第 4 条）

## Global Constraints

- **行为不变。** 纯重组：渲染结果、异步时序、事件处理、未保存守卫、渲染期调整语义一律不变。**唯一允许的改动是搬位置、改 import、引入新 props 签名。**
- **分层硬约束：** 拆出的组件放进 `components/`，**只可 import `components/*` 与 `lib/core/*`**。**实测 kb 页目前只 import `@/lib/core/utils`（cn）与 `@/components/*`，没越界。** 拆分后全部新文件也必须守在这条线内。
- **隔离检出：** 本阶段实现者在独立 git worktree 里工作。主检出供 controller 用。
- **分支**：`refactor/stage5e-kb`。不 push。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**；不要对不合 prettier 的文件跑 `--write`。

## 当前结构（实施前自己复核，行号会漂）

```
  1– 71   import + "use client"
 73– 86   KbStats / KbChunk / IngestResult 类型
 88– 90   TreeNode 类型
 92–141   buildTree(files)
143–145   encPath(f)
147–177   MarkdownBody 组件
179–1052  KbPage
  180–209   状态（含 dialogs 状态 + pendingNav）
  211–226   loadFiles / loadStats / resetActiveFile
  228–233   初始加载 effect
  235–250   prevFiles 渲染期调整（展开一级目录）
  252–261   beforeunload effect
  263–274   ⌘/Ctrl+S effect（eslint-disable + 依赖 content）
  276–277   chunksOf
  279–286   filteredFiles / tree
  288–306   prevSearch 渲染期调整（搜索展开目录）
  308–337   loadChunks / openFile
  339–364   requestOpen / closeFile / confirmDiscard
  366–421   saveOnly / ingest / saveAndIngest
  423–463   createFile
  465–499   renameFile
  501–525   deleteFile
  527–534   toggleDir
  536–616   renderTree / countFiles
  618       orphan
  620–1051  JSX
```

## 目标结构

```
components/admin/kb/
  types.ts          # KbStats / KbChunk / IngestResult / PendingNav
  tree.ts           # TreeNode / buildTree / encPath / countFiles
  markdown-body.tsx # MarkdownBody
  file-tree.tsx     # FileTree —— 文件树（受控）
  editor-panel.tsx  # EditorPanel —— 编辑/预览/分块（受控）
  file-dialogs.tsx  # FileDialogs —— 四个对话框（受控）
  use-kb-files.ts   # 核心状态 hook（状态 + 动作 + 两个渲染期调整 + 三个 effect）
app/admin/kb/page.tsx # 只做编排 + 三个 Notice + MasterDetail 组装
```

## Task 1: 抽 types.ts + tree.ts + markdown-body.tsx

**Files:**
- Create: `components/admin/kb/types.ts`、`tree.ts`、`markdown-body.tsx`
- Modify: `app/admin/kb/page.tsx`

- [ ] **Step 0: 隔离环境准备**

worktree 里没有 `node_modules`，符号链接过来（静态验证够用；真机验证阶段按 Task 5 Step 0 换真实依赖）：

```bash
ln -s /Users/ziyou/projects/prayer/node_modules node_modules
pnpm vitest run tests/lib/core/format-duration.test.ts   # 冒烟
```

若符号链接后 Turbopack 起 dev 报 `Symlink [project]/node_modules is invalid`，按 Task 5 Step 0 删链接、`CI=true pnpm install`。

- [ ] **Step 1: 抽 `types.ts`**

把 L73–86 的类型与 L205 的 `PendingNav` 搬进 `types.ts`：

```ts
export interface KbStats {
  chunks: number
  vecs: number
  dim: number
  docs: { doc: string; chunks: number }[]
}

export interface KbChunk {
  id: number
  content: string
}

export interface IngestResult {
  file: string
  chunks: number
}

export type PendingNav = { type: "open"; path: string } | { type: "clear" }
```

- [ ] **Step 2: 抽 `tree.ts`**

把 L88–90（`TreeNode`）、L92–141（`buildTree`）、L143–145（`encPath`）、L613–616（`countFiles`）原样搬进 `tree.ts`：

```ts
export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string }

export function buildTree(files: string[]): TreeNode[] {
  type MutableDir = {
    kind: "dir"
    name: string
    path: string
    kids: Map<string, MutableDir | { kind: "file"; name: string; path: string }>
  }
  const root: MutableDir = { kind: "dir", name: "", path: "", kids: new Map() }

  for (const f of files) {
    const parts = f.split("/")
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isFile = i === parts.length - 1
      if (isFile) {
        cur.kids.set(part, { kind: "file", name: part, path: f })
      } else {
        const dirPath = parts.slice(0, i + 1).join("/")
        let next = cur.kids.get(part)
        if (!next || next.kind !== "dir") {
          next = { kind: "dir", name: part, path: dirPath, kids: new Map() }
          cur.kids.set(part, next)
        }
        cur = next as MutableDir
      }
    }
  }

  function freeze(d: MutableDir): TreeNode[] {
    const dirs: TreeNode[] = []
    const filesOut: TreeNode[] = []
    for (const [, node] of [...d.kids.entries()].sort(([a], [b]) =>
      a.localeCompare(b, "zh")
    )) {
      if (node.kind === "dir") {
        dirs.push({
          kind: "dir",
          name: node.name,
          path: node.path,
          children: freeze(node),
        })
      } else {
        filesOut.push(node)
      }
    }
    return [...dirs, ...filesOut]
  }
  return freeze(root)
}

export function encPath(f: string) {
  return f.split("/").map(encodeURIComponent).join("/")
}

export function countFiles(n: TreeNode): number {
  if (n.kind === "file") return 1
  return n.children.reduce((s, c) => s + countFiles(c), 0)
}
```

- [ ] **Step 3: 抽 `markdown-body.tsx`**

把 L147–177 的 `MarkdownBody` 原样搬进 `markdown-body.tsx`：

```tsx
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/core/utils"

export function MarkdownBody({ source }: { source: string }) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-medium",
        "[&_p]:my-2 [&_p]:leading-relaxed",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-4 [&_hr]:border-border",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
        "[&_th]:border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium",
        "[&_td]:border [&_td]:px-2 [&_td]:py-1.5",
        "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md"
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {source || "*（空文档）*"}
      </ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 4: 页面改为 import**

`app/admin/kb/page.tsx` 删掉 L73–90（类型）、L92–145（buildTree/encPath）、L147–177（MarkdownBody）、L613–616（countFiles）的定义，改成：

```ts
import type { KbStats, KbChunk, IngestResult, PendingNav } from "@/components/admin/kb/types"
import { buildTree, encPath, countFiles, type TreeNode } from "@/components/admin/kb/tree"
import { MarkdownBody } from "@/components/admin/kb/markdown-body"
```

**注意**：`ReactMarkdown`/`remarkGfm` 只被 MarkdownBody 用，页面删掉这两个 import。其余 import（`cn`、lucide 图标、ui 组件）本阶段页面还在用，保留。

- [ ] **Step 5: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；975 用例全过（契约测试此时还不会红 —— 页面里仍有 `InputGroupInput`/`saveAndIngest`/`待重建索引`）。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(admin): kb 页的类型、文件树纯函数与 Markdown 渲染外提

KbStats/KbChunk/IngestResult/PendingNav 类型、TreeNode/buildTree/encPath/
countFiles 纯函数、MarkdownBody 组件,页面与后续区块组件共用,按 5d 模式
放进 components/admin/kb/。代码原样搬移,只改 import。"
```

## Task 2: 抽 use-kb-files.ts

**Files:**
- Create: `components/admin/kb/use-kb-files.ts`
- Modify: `app/admin/kb/page.tsx`

**摩擦点（本 Task 核心）：** 三个必须逐字保留的地方 —— ① L235–250 的 `prevFiles` 渲染期调整；② L288–306 的 `prevSearch` 渲染期调整；③ L263–274 的 ⌘/Ctrl+S effect（含 `eslint-disable` 与依赖 `content`）。**不得改成 effect、不得删注释、不得改依赖数组。**

- [ ] **Step 1: 写 hook**

创建 `use-kb-files.ts`。**代码原样搬** L180–534 与 L618 的状态/动作/effect/渲染期调整/派生，去掉 `renderTree`/`countFiles`（`countFiles` 已进 tree.ts），返回对象。完整实现：

```ts
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { buildTree, encPath } from "./tree"
import type { KbStats, KbChunk, IngestResult, PendingNav } from "./types"

export function useKbFiles() {
  const [files, setFiles] = useState<string[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [stats, setStats] = useState<KbStats | null>(null)
  const [chunks, setChunks] = useState<KbChunk[]>([])
  const [loadingChunks, setLoadingChunks] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  /** 保存后尚未重建的文档 */
  const [dirtyDocs, setDirtyDocs] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<"edit" | "preview" | "chunks">("edit")

  // dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [createPath, setCreatePath] = useState("")
  const [renameOpen, setRenameOpen] = useState(false)
  const [renamePath, setRenamePath] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busyFs, setBusyFs] = useState(false)

  // unsaved switch guard
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null)

  const unsaved = active != null && content !== savedContent
  const dirty = active ? dirtyDocs.has(active) || unsaved : false

  const loadFiles = useCallback(async () => {
    const r = await fetch("/api/kb").then((x) => x.json())
    if (r.ok) setFiles(r.data as string[])
  }, [])

  const loadStats = useCallback(async () => {
    const r = await fetch("/api/kb/vec").then((x) => x.json())
    if (r.ok) setStats(r.data as KbStats)
  }, [])

  const resetActiveFile = useCallback(() => {
    setActive(null)
    setContent("")
    setSavedContent("")
    setChunks([])
  }, [])

  // 初始加载挪进异步边界:setState 不落在 effect 同步路径上
  useEffect(() => {
    void (async () => {
      await Promise.all([loadFiles(), loadStats()])
    })()
  }, [loadFiles, loadStats])

  // 有文件时默认展开一级目录(渲染期调整,替代 effect 内同步 setState)
  const [prevFiles, setPrevFiles] = useState(files)
  if (files !== prevFiles) {
    setPrevFiles(files)
    if (files?.length) {
      setExpanded((prev) => {
        if (prev.size > 0) return prev
        const next = new Set<string>()
        for (const f of files) {
          const i = f.indexOf("/")
          if (i > 0) next.add(f.slice(0, i))
        }
        return next
      })
    }
  }

  // 离开页面前拦截未保存
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [unsaved])

  // ⌘/Ctrl+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        if (active && unsaved && !saving && !ingesting) void saveOnly()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, unsaved, saving, ingesting, content])

  const chunksOf = (f: string) =>
    stats?.docs.find((d) => d.doc === f)?.chunks ?? 0

  const filteredFiles = useMemo(() => {
    if (!files) return []
    const q = query.trim().toLowerCase()
    if (!q) return files
    return files.filter((f) => f.toLowerCase().includes(q))
  }, [files, query])

  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles])

  // 搜索时自动展开匹配路径上的目录(渲染期调整,替代 effect 内同步 setState)
  const [prevSearch, setPrevSearch] = useState({ query, filteredFiles })
  if (
    prevSearch.query !== query ||
    prevSearch.filteredFiles !== filteredFiles
  ) {
    setPrevSearch({ query, filteredFiles })
    if (query.trim()) {
      setExpanded((prev) => {
        const next = new Set(prev)
        for (const f of filteredFiles) {
          const parts = f.split("/")
          for (let i = 1; i < parts.length; i++)
            next.add(parts.slice(0, i).join("/"))
        }
        return next
      })
    }
  }

  async function loadChunks(f: string) {
    setLoadingChunks(true)
    try {
      const r = await fetch(`/api/kb/vec?doc=${encodeURIComponent(f)}`).then(
        (x) => x.json()
      )
      setChunks(r.ok ? (r.data as KbChunk[]) : [])
    } finally {
      setLoadingChunks(false)
    }
  }

  async function openFile(f: string) {
    setLoadingFile(true)
    setActive(f)
    setChunks([])
    setTab("edit")
    try {
      const r = await fetch(`/api/kb/${encPath(f)}`).then((x) => x.json())
      if (r.ok) {
        setContent(r.data as string)
        setSavedContent(r.data as string)
      } else {
        toast.error(r.error || "打开失败")
      }
      void loadChunks(f)
    } finally {
      setLoadingFile(false)
    }
  }

  function requestOpen(f: string) {
    if (f === active) return
    if (unsaved) {
      setPendingNav({ type: "open", path: f })
      return
    }
    void openFile(f)
  }

  function closeFile() {
    if (unsaved) {
      setPendingNav({ type: "clear" })
      return
    }
    resetActiveFile()
  }

  function confirmDiscard() {
    const p = pendingNav
    setPendingNav(null)
    if (!p) return
    if (p.type === "open") void openFile(p.path)
    else {
      resetActiveFile()
    }
  }

  async function saveOnly(): Promise<boolean> {
    if (!active) return false
    setSaving(true)
    try {
      const r = await fetch(`/api/kb/${encPath(active)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      }).then((x) => x.json())
      if (r.ok) {
        setSavedContent(content)
        setDirtyDocs((prev) => new Set(prev).add(active))
        toast.success(`已保存 ${active}（尚未重建索引）`)
        return true
      }
      toast.error(`保存失败:${r.error}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function ingest(): Promise<boolean> {
    setIngesting(true)
    try {
      const r = await fetch("/api/kb/ingest", { method: "POST" }).then((x) =>
        x.json()
      )
      if (r.ok) {
        const results = (r.data ?? []) as IngestResult[]
        if (results.length === 0) toast.success("索引重建完成：无文件")
        else {
          const totalChunks = results.reduce((sum, x) => sum + x.chunks, 0)
          toast.success(
            `索引重建完成：${results.length} 个文档，共 ${totalChunks} 个分块`
          )
        }
        setDirtyDocs(new Set())
        void loadStats()
        if (active) void loadChunks(active)
        return true
      }
      toast.error(`重建失败：${r.error}`)
      return false
    } catch (e) {
      toast.error(`重建失败：${e instanceof Error ? e.message : String(e)}`)
      return false
    } finally {
      setIngesting(false)
    }
  }

  async function saveAndIngest() {
    const okSave = await saveOnly()
    if (okSave) await ingest()
  }

  async function createFile() {
    const path = createPath.trim().replace(/^\/+/, "")
    if (!path) {
      toast.error("请输入路径")
      return
    }
    setBusyFs(true)
    try {
      const r = await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          content: `# ${
            path
              .split("/")
              .pop()
              ?.replace(/\.(md|txt)$/, "") ?? "新文档"
          }\n\n`,
        }),
      }).then((x) => x.json())
      if (r.ok) {
        toast.success(`已创建 ${r.data.path}`)
        setCreateOpen(false)
        setCreatePath("")
        await loadFiles()
        const parts = (r.data.path as string).split("/")
        setExpanded((prev) => {
          const next = new Set(prev)
          for (let i = 1; i < parts.length; i++)
            next.add(parts.slice(0, i).join("/"))
          return next
        })
        if (unsaved) setPendingNav({ type: "open", path: r.data.path })
        else void openFile(r.data.path as string)
      } else toast.error(r.error || "创建失败")
    } finally {
      setBusyFs(false)
    }
  }

  async function renameFile() {
    if (!active) return
    const newPath = renamePath.trim().replace(/^\/+/, "")
    if (!newPath) {
      toast.error("请输入新路径")
      return
    }
    if (unsaved) {
      toast.message("请先保存或丢弃未保存改动")
      return
    }
    setBusyFs(true)
    try {
      const r = await fetch(`/api/kb/${encPath(active)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPath }),
      }).then((x) => x.json())
      if (r.ok) {
        const next = r.data.path as string
        toast.success(`已重命名为 ${next}`)
        setRenameOpen(false)
        setDirtyDocs((prev) => {
          const n = new Set(prev)
          if (n.delete(active)) n.add(next)
          return n
        })
        await loadFiles()
        void loadStats()
        void openFile(next)
      } else toast.error(r.error || "重命名失败")
    } finally {
      setBusyFs(false)
    }
  }

  async function deleteFile() {
    if (!active) return
    setBusyFs(true)
    try {
      const r = await fetch(`/api/kb/${encPath(active)}`, {
        method: "DELETE",
      }).then((x) => x.json())
      if (r.ok) {
        toast.success(
          `已删除 ${active}${r.data.purged ? `（清 ${r.data.purged} 分块）` : ""}`
        )
        setDeleteOpen(false)
        setDirtyDocs((prev) => {
          const n = new Set(prev)
          n.delete(active)
          return n
        })
        resetActiveFile()
        await loadFiles()
        void loadStats()
      } else toast.error(r.error || "删除失败")
    } finally {
      setBusyFs(false)
    }
  }

  function toggleDir(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const orphan = stats ? stats.chunks - stats.vecs : 0

  return {
    files, active, content, savedContent, saving, ingesting, stats, chunks,
    loadingChunks, loadingFile, dirtyDocs, query, setQuery, expanded, tab, setTab,
    createOpen, setCreateOpen, createPath, setCreatePath,
    renameOpen, setRenameOpen, renamePath, setRenamePath,
    deleteOpen, setDeleteOpen, busyFs, pendingNav, setPendingNav,
    unsaved, dirty, filteredFiles, tree, orphan,
    requestOpen, closeFile, confirmDiscard, saveOnly, ingest, saveAndIngest,
    createFile, renameFile, deleteFile, toggleDir, chunksOf,
  }
}
```

- [ ] **Step 2: 页面改用 hook**

`app/admin/kb/page.tsx` 的 `KbPage` 删掉 L180–534（状态 + 动作 + effect + 渲染期调整）与 L618（orphan），改成：

```ts
const kb = useKbFiles()
```

页面里对这些标识符的引用全部改成 `kb.xxx`（`content`/`setContent`/`saving`/`ingesting`/`stats`/`chunks`/`loadingChunks`/`loadingFile`/`dirtyDocs`/`query`/`setQuery`/`expanded`/`tab`/`setTab`/`createOpen`/`setCreateOpen`/`createPath`/`setCreatePath`/`renameOpen`/`setRenameOpen`/`renamePath`/`setRenamePath`/`deleteOpen`/`setDeleteOpen`/`busyFs`/`pendingNav`/`setPendingNav`/`unsaved`/`dirty`/`filteredFiles`/`tree`/`orphan`/`requestOpen`/`closeFile`/`confirmDiscard`/`saveOnly`/`ingest`/`saveAndIngest`/`createFile`/`renameFile`/`deleteFile`/`toggleDir`/`chunksOf`/`active`/`files`）。`renderTree`/`countFiles` 本 Task 暂留在页面（Task 3 再抽走），它们内部对 `expanded`/`active`/`dirtyDocs`/`unsaved`/`query`/`chunksOf`/`requestOpen`/`toggleDir` 的引用改成从 `kb` 取。

> **本 Task 结束时页面仍能编译、能跑。** JSX 尚未抽走，只是所有状态/动作/派生改从 `kb` 取。

- [ ] **Step 3: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；975 用例全过。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(admin): kb 页的状态与动作收进 use-kb-files

状态、fetch 动作、未保存守卫、两处渲染期调整、三个 effect 是一体,
整体进一个 hook。渲染期调整与 ⌘S effect 逐字保留(不改成 effect、
不删 eslint-disable 与注释)。"
```

## Task 3: 抽 file-tree.tsx + editor-panel.tsx + file-dialogs.tsx

**Files:**
- Create: `components/admin/kb/file-tree.tsx`、`editor-panel.tsx`、`file-dialogs.tsx`
- Modify: `app/admin/kb/page.tsx`

三个区块互相独立，做成受控组件。**JSX 原样搬，只改回调。**

- [ ] **Step 1: 抽 `file-tree.tsx`**

把 L698–750 的 `list`（`SectionCard` 整段，含标题/搜索/DataState/renderTree 调用）与 L536–611 的 `renderTree` 搬进 `file-tree.tsx`。`renderTree` 在组件内定义，用 props 替代原对 hook 状态的引用。

```tsx
import { FileText, Folder, FolderOpen, ChevronRight, ChevronDown, Search, X } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { SectionCard } from "@/components/admin/section-card"
import { DataState } from "@/components/admin/data-state"
import { cn } from "@/lib/core/utils"
import { countFiles, type TreeNode } from "./tree"

interface FileTreeProps {
  files: string[] | null
  filteredFiles: string[]
  query: string
  setQuery: (q: string) => void
  expanded: Set<string>
  active: string | null
  dirtyDocs: Set<string>
  unsaved: boolean
  tree: TreeNode[]
  chunksOf: (f: string) => number
  onOpen: (f: string) => void
  onToggleDir: (path: string) => void
}

export function FileTree({
  files, filteredFiles, query, setQuery, expanded, active, dirtyDocs,
  unsaved, tree, chunksOf, onOpen, onToggleDir,
}: FileTreeProps) {
  function renderTree(nodes: TreeNode[], depth = 0): ReactNode {
    return nodes.map((n) => {
      // 原 L538–610 的 dir/file 两分支原样搬,
      // 仅: expanded.has→用 props 的 expanded、active===n.path→用 props 的 active、
      // dirtyDocs.has→props、unsaved→props、query→props、chunksOf→props、
      // toggleDir→onToggleDir、requestOpen→onOpen
    })
  }
  return (
    <SectionCard
      title="文件"
      description={files ? `${filteredFiles.length}${query ? ` / ${files.length}` : ""} 个` : undefined}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      contentClassName="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
    >
      {/* 原 L708–749 的搜索框 + DataState + renderTree(tree) 原样搬入 */}
    </SectionCard>
  )
}
```

**注意** `import type { ReactNode } from "react"`（renderTree 返回类型用）。`renderTree` 里的 `countFiles(n)` 从 `./tree` import。

- [ ] **Step 2: 抽 `editor-panel.tsx`**

把 L754–921 的 `detail`（`SectionCard` 整段，含标题/action/Tabs 编辑·预览·分块）搬进 `editor-panel.tsx`。**改动：** `setRenamePath(active)`/`setRenameOpen(true)` → `onRename()`；`setDeleteOpen(true)` → `onDelete()`；`saveOnly()` → `onSaveOnly()`；`saveAndIngest()` → `onSaveAndIngest()`。

```tsx
import { Pencil, Trash2, Code2, Eye, Save, Boxes } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SectionCard } from "@/components/admin/section-card"
import { DataState } from "@/components/admin/data-state"
import { ItemCard } from "@/components/admin/item-card"
import { MarkdownBody } from "./markdown-body"
import type { KbChunk } from "./types"

interface EditorPanelProps {
  active: string
  content: string
  setContent: (c: string) => void
  saving: boolean
  ingesting: boolean
  loadingFile: boolean
  loadingChunks: boolean
  chunks: KbChunk[]
  tab: "edit" | "preview" | "chunks"
  setTab: (t: "edit" | "preview" | "chunks") => void
  unsaved: boolean
  dirty: boolean
  busyFs: boolean
  chunksOf: (f: string) => number
  onSaveOnly: () => void
  onSaveAndIngest: () => void
  onRename: () => void
  onDelete: () => void
}

export function EditorPanel({ ... }: EditorPanelProps) {
  return (
    <SectionCard
      title={/* 原 L756–773 标题 JSX,用 props 的 active/unsaved/dirtyDocs→dirty */}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      contentClassName="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      action={/* 原 L778–803 重命名/删除按钮,setRename*→onRename、setDeleteOpen→onDelete */}
    >
      {/* 原 L805–920 的 loadingFile 骨架 + Tabs(编辑/预览/分块) 原样搬,
          仅 saveOnly→onSaveOnly、saveAndIngest→onSaveAndIngest */}
    </SectionCard>
  )
}
```

- [ ] **Step 3: 抽 `file-dialogs.tsx`**

把 L938–1049 的四个对话框（新建 Dialog、重命名 Dialog、删除 AlertDialog、未保存切换 AlertDialog）搬进 `file-dialogs.tsx`。**改动：** `createFile()` → `onCreate()`、`renameFile()` → `onRename()`、`deleteFile()` → `onDelete()`、`confirmDiscard` → `onConfirmDiscard()`。

```tsx
import { AlertTriangle, Plus, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { PendingNav } from "./types"

interface FileDialogsProps {
  createOpen: boolean
  setCreateOpen: (v: boolean) => void
  createPath: string
  setCreatePath: (v: string) => void
  renameOpen: boolean
  setRenameOpen: (v: boolean) => void
  renamePath: string
  setRenamePath: (v: string) => void
  deleteOpen: boolean
  setDeleteOpen: (v: boolean) => void
  busyFs: boolean
  pendingNav: PendingNav | null
  setPendingNav: (v: PendingNav | null) => void
  active: string | null
  onCreate: () => void
  onRename: () => void
  onDelete: () => void
  onConfirmDiscard: () => void
}

export function FileDialogs({ ... }: FileDialogsProps) {
  return (
    <>
      {/* 原 L938–969 新建 Dialog 原样搬,createFile→onCreate */}
      {/* 原 L971–1000 重命名 Dialog 原样搬,renameFile→onRename */}
      {/* 原 L1002–1025 删除 AlertDialog 原样搬,deleteFile→onDelete */}
      {/* 原 L1027–1049 未保存切换 AlertDialog 原样搬,confirmDiscard→onConfirmDiscard */}
    </>
  )
}
```

- [ ] **Step 4: 页面改为 import 这三个区块**

`app/admin/kb/page.tsx` 删掉 L536–616（renderTree/countFiles）、L698–750（list）、L754–921（detail）、L938–1049（四个对话框）四段，改成：

```tsx
<MasterDetail
  selected={!!kb.active}
  onBack={kb.closeFile}
  breakpoint="md"
  listWidth="280px"
  backLabel="返回文件列表"
  className="min-h-0 flex-1"
  list={
    <FileTree
      files={kb.files}
      filteredFiles={kb.filteredFiles}
      query={kb.query}
      setQuery={kb.setQuery}
      expanded={kb.expanded}
      active={kb.active}
      dirtyDocs={kb.dirtyDocs}
      unsaved={kb.unsaved}
      tree={kb.tree}
      chunksOf={kb.chunksOf}
      onOpen={kb.requestOpen}
      onToggleDir={kb.toggleDir}
    />
  }
  detail={
    kb.active ? (
      <EditorPanel
        active={kb.active}
        content={kb.content}
        setContent={kb.setContent}
        saving={kb.saving}
        ingesting={kb.ingesting}
        loadingFile={kb.loadingFile}
        loadingChunks={kb.loadingChunks}
        chunks={kb.chunks}
        tab={kb.tab}
        setTab={kb.setTab}
        unsaved={kb.unsaved}
        dirty={kb.dirty}
        busyFs={kb.busyFs}
        chunksOf={kb.chunksOf}
        onSaveOnly={() => void kb.saveOnly()}
        onSaveAndIngest={() => void kb.saveAndIngest()}
        onRename={() => { kb.setRenamePath(kb.active!); kb.setRenameOpen(true) }}
        onDelete={() => kb.setDeleteOpen(true)}
      />
    ) : (
      <SectionCard
        title="预览"
        className="flex min-h-0 min-w-0 flex-col"
        contentClassName="flex flex-1 items-center justify-center"
      >
        <EmptyState icon={BookOpen} title="未选择文件" description="从左侧选择文档，或点「新建」创建。" />
      </SectionCard>
    )
  }
/>

<FileDialogs
  createOpen={kb.createOpen} setCreateOpen={kb.setCreateOpen}
  createPath={kb.createPath} setCreatePath={kb.setCreatePath}
  renameOpen={kb.renameOpen} setRenameOpen={kb.setRenameOpen}
  renamePath={kb.renamePath} setRenamePath={kb.setRenamePath}
  deleteOpen={kb.deleteOpen} setDeleteOpen={kb.setDeleteOpen}
  busyFs={kb.busyFs}
  pendingNav={kb.pendingNav} setPendingNav={kb.setPendingNav}
  active={kb.active}
  onCreate={() => void kb.createFile()}
  onRename={() => void kb.renameFile()}
  onDelete={() => void kb.deleteFile()}
  onConfirmDiscard={kb.confirmDiscard}
/>
```

删掉页面不再直接引用的 import（`ReactMarkdown`/`remarkGfm` 已在 Task 1 删；本 Task 删 `Textarea`/`Tabs*`/`ScrollArea`/`Dialog*`/`AlertDialog*`/`Notice`/`ItemCard`/`DataState`/`EmptyState`/`SectionCard` 等**逐个确认**）。**保留**：`PageShell`/`PageHeader`/`MasterDetail`/`Button`/`Spinner`（PageHeader actions）/`Input`? 等仍在页面用的。三个 `Notice` 与 stats `<p>` 留在页面（它们是页面级布局）。

- [ ] **Step 5: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run tests/architecture/layering.test.ts
pnpm vitest run
```

Expected: typecheck 无输出；layering 护栏 9 绿；**但 `tests/ui/admin-knowledge-contracts.test.ts` 的两个用例会红**（`InputGroupInput`/`aria-label="搜索路径"` 搬进 file-tree；`saveAndIngest`/`"/api/kb/ingest"`/`待重建索引` 搬进 hook/editor）—— 预期，Task 4 修。

**并自查**新组件 import 没越出 `components/*` 与 `lib/core/*`：

```bash
grep -n "^import" components/admin/kb/*.tsx components/admin/kb/*.ts
```

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(admin): 拆出 kb 页的文件树、编辑器与对话框

FileTree / EditorPanel / FileDialogs 做成受控组件,状态仍在
use-kb-files hook 与页面。renderTree 随 FileTree 外提。代码原样搬移,
只改回调与 import。"
```

## Task 4: 修契约测试

**Files:**
- Modify: `tests/ui/admin-knowledge-contracts.test.ts`

> **⚠️ 会打破两条契约测试（Task 3 抽组件后必红）。** 断言对象是「这套语义仍在」，不是「必须写在某个文件里」。修法是把新文件加进读取列表，**不要**为了让测试过而把 JSX 留在页面，**也不要**删断言。

- [ ] **Step 1: 修「uses the shared search input group」用例（L19–23）**

搜索框搬进 `file-tree.tsx`。修法：

```ts
it("uses the shared search input group on the knowledge file list", async () => {
  const [page, fileTree] = await Promise.all([
    read("app/admin/kb/page.tsx"),
    read("components/admin/kb/file-tree.tsx"),
  ])
  const source = page + "\n" + fileTree

  expect(source).toContain("InputGroupInput")
  expect(source).toContain('aria-label="搜索路径"')
})
```

- [ ] **Step 2: 修「preserves the knowledge base save and ingest flow」用例（L25–34）**

`saveAndIngest`/`"/api/kb/ingest"` 搬进 hook，`待重建索引` 搬进 editor-panel；`<MasterDetail`/`backLabel` 仍在页面。修法：

```ts
it("preserves the knowledge base save and ingest flow", async () => {
  const [page, hook, editor] = await Promise.all([
    read("app/admin/kb/page.tsx"),
    read("components/admin/kb/use-kb-files.ts"),
    read("components/admin/kb/editor-panel.tsx"),
  ])
  const source = [page, hook, editor].join("\n")

  expect(source).toContain("saveAndIngest")
  expect(source).toContain('"/api/kb/ingest"')
  expect(source).toContain("待重建索引")
  expect(source).toContain("<MasterDetail")
  expect(source).toContain('backLabel="返回文件列表"')
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
wc -l app/admin/kb/page.tsx
```

Expected: 约 150 行。**若仍在 250 行以上，说明还有东西没搬出去** —— 回报里说明是哪些、为什么留着。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "test(ui): kb 页拆分后契约测试改读新组件与 hook

搜索框语义搬进 file-tree.tsx,保存/重建语义搬进 use-kb-files.ts 与
editor-panel.tsx,测试改同时读页面与对应新文件。"
```

## Task 5: 真机验证（本阶段特有）

**为什么必须做：** 这是最后一个后台页，且有两处「渲染期调整 state」与未保存守卫/⌘S 保存 —— 拆分若伤到任何一处，都是静默的行为退化。

- [ ] **Step 0: 若 worktree 里 Turbopack 因符号链接 node_modules 报错**

```bash
unlink node_modules
CI=true pnpm install
```

- [ ] **Step 1: 按仓库隔离配方起实例**

```bash
mkdir -p /tmp/verify-5e
DB_PATH=/tmp/verify-5e/agent.db \
CLAUDE_CONFIG_DIR=/tmp/verify-5e/claude-config \
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

kb 页读 `/api/kb`（`docs/kb/**` 的文件列表，来自 `kb_chunks`/文件系统）。空库无文档。**最简单：往 `docs/kb/` 放两个 .md 文件，再点「重建索引」或直接起服务后浏览器打开 `/admin/kb` 看文件是否列出**（文件列表读文件系统，不一定需要入库）。放 `docs/kb/faq/a.md`、`docs/kb/guide/b.md` 两个文件，验证树形展开与文件打开。

（若文件列表 API 依赖已入库的 `kb_chunks` 而非文件系统，读 `app/api/kb/route.ts` 确认数据来源，按需改用 `kb_chunks` 表造数据。）

- [ ] **Step 3: 用浏览器打开 `/admin/kb` 逐项核对**

- 页面正常渲染，文件树列出 `faq/` 与 `guide/` 两个目录，默认展开一级
- 点目录 → 展开/收起子项
- 点文件 → 右侧编辑页打开，标题显示路径，编辑框有内容
- 编辑内容 → 出现「未保存」徽章 + 顶部「未保存改动」Notice + 「仅保存」/「保存并生效」按钮可点
- 点「仅保存」→ 有 toast「已保存 …（尚未重建索引）」，徽章变「未重建」
- 切到「预览」tab → Markdown 渲染；切到「分块」tab → 空态
- 搜索框输入 → 文件树过滤 + 自动展开匹配路径
- 未保存时点别的文件 → 弹「丢弃未保存改动？」确认框，点「丢弃并继续」切换
- 点「新建」→ 弹新建对话框；点「重命名」→ 弹重命名对话框；点「删除」→ 弹删除确认
- 轮询不把展开/编辑态冲掉

**若无法起服务或无法开浏览器，如实报告，不要跳过这项就说完成。**

- [ ] **Step 4: 记录结果**

把实际观察到的现象写进回报（**截图更好**）。任何与拆分前不一致的现象都要报。

- [ ] **Step 5: 清理**

```bash
rm -rf /tmp/verify-5e
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
git worktree remove .claude/worktrees/stage5e
```

（合回 main 之后。）

- [ ] **Step 3: 工作区干净**

```bash
git status --short
```

## 阶段 5 全部完成后的总验收

1. 四个后台页（reflection/groups/sessions/kb）全部拆完，每页 `pnpm check` 全绿。
2. `layering.test.ts` 全程 9 绿（`components/` 只依赖 core）。
3. `lib/` 根目录只剩 `runtime.ts`（阶段 1–4 已完成，本阶段不涉及）。
4. 若在跑实例需生效，另行重启（`pnpm pm:restart`），不属本阶段范围。
