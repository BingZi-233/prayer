"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import {
  FileText,
  RefreshCw,
  Save,
  BookOpen,
  AlertTriangle,
  Boxes,
  Search,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  X,
  Eye,
  Code2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { Notice } from "@/components/admin/notice"
import { ItemCard } from "@/components/admin/item-card"
import { MasterDetail } from "@/components/admin/master-detail"
import { DataState, EmptyState } from "@/components/admin/data-state"
import { cn } from "@/lib/utils"

interface KbStats {
  chunks: number
  vecs: number
  dim: number
  docs: { doc: string; chunks: number }[]
}
interface KbChunk {
  id: number
  content: string
}
interface IngestResult {
  file: string
  chunks: number
}

type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string }

function buildTree(files: string[]): TreeNode[] {
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

function encPath(f: string) {
  return f.split("/").map(encodeURIComponent).join("/")
}

function MarkdownBody({ source }: { source: string }) {
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

export default function KbPage() {
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
  type PendingNav = { type: "open"; path: string } | { type: "clear" }
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
        // 展开父目录
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

  function renderTree(nodes: TreeNode[], depth = 0): ReactNode {
    return nodes.map((n) => {
      if (n.kind === "dir") {
        const open = expanded.has(n.path) || !!query.trim()
        return (
          <div key={`d:${n.path}`} className="min-w-0">
            <button
              type="button"
              onClick={() => toggleDir(n.path)}
              className="flex w-full min-w-0 items-center gap-1 rounded-md py-1 pr-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
              style={{ paddingLeft: 6 + depth * 12 }}
            >
              {open ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              {open ? (
                <FolderOpen className="size-3.5 shrink-0" />
              ) : (
                <Folder className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">
                {n.name}
              </span>
              <span className="shrink-0 text-muted-foreground/70 tabular-nums">
                {countFiles(n)}
              </span>
            </button>
            {open && renderTree(n.children, depth + 1)}
          </div>
        )
      }
      const isActive = active === n.path
      const isDirtyDoc = dirtyDocs.has(n.path)
      const isUnsavedActive = isActive && unsaved
      return (
        <button
          key={`f:${n.path}`}
          type="button"
          onClick={() => requestOpen(n.path)}
          className={cn(
            "flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-xs hover:bg-muted",
            isActive && "bg-muted font-medium"
          )}
          style={{ paddingLeft: 6 + depth * 12 + 14 }}
          title={n.path}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{n.name}</span>
          {isUnsavedActive ? (
            <Badge
              variant="destructive"
              className="h-4 shrink-0 px-1 text-[10px]"
            >
              未保存
            </Badge>
          ) : isDirtyDoc ? (
            <Badge
              variant="destructive"
              className="h-4 shrink-0 px-1 text-[10px]"
            >
              未重建
            </Badge>
          ) : chunksOf(n.path) > 0 ? (
            <Badge
              variant="secondary"
              className="h-4 shrink-0 px-1 text-[10px] tabular-nums"
            >
              {chunksOf(n.path)}
            </Badge>
          ) : null}
        </button>
      )
    })
  }

  function countFiles(n: TreeNode): number {
    if (n.kind === "file") return 1
    return n.children.reduce((s, c) => s + countFiles(c), 0)
  }

  const orphan = stats ? stats.chunks - stats.vecs : 0

  return (
    <PageShell fill>
      <PageHeader
        className="shrink-0"
        title="知识库"
        description="编辑知识文档。⌘/Ctrl+S 保存；「保存并生效」会写入并重建检索索引。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreatePath(
                  active?.includes("/")
                    ? active.slice(0, active.lastIndexOf("/") + 1)
                    : ""
                )
                setCreateOpen(true)
              }}
            >
              <Plus data-icon="inline-start" />
              新建
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void ingest()}
              disabled={ingesting}
            >
              {ingesting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {ingesting ? "重建中…" : "重建索引"}
            </Button>
          </div>
        }
      />

      {stats && (
        <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {stats.docs.length} 个文档 · {stats.chunks} 个分块 · 已索引{" "}
          {stats.vecs} · 维度 {stats.dim}
        </p>
      )}

      {unsaved && (
        <Notice
          variant="warning"
          title="当前文档有未保存改动"
          description="按 ⌘/Ctrl+S 仅保存，或在编辑页「保存并生效」写入并重建索引。"
          className="shrink-0"
        />
      )}
      {orphan !== 0 && (
        <Notice
          variant="warning"
          title={`${orphan} 个分块缺少向量`}
          description="需要点右上角「重建索引」补齐检索向量。"
          className="shrink-0"
        />
      )}
      {dirtyDocs.size > 0 && (
        <Notice
          variant="warning"
          title={`${dirtyDocs.size} 个文档已改未重建`}
          description={`${Array.from(dirtyDocs).join(", ")} —— 检索索引仍是旧内容。`}
          className="shrink-0"
        />
      )}

      <MasterDetail
        selected={!!active}
        onBack={closeFile}
        breakpoint="md"
        listWidth="280px"
        backLabel="返回文件列表"
        className="min-h-0 flex-1"
        list={
          <SectionCard
            title="文件"
            description={
              files
                ? `${filteredFiles.length}${query ? ` / ${files.length}` : ""} 个`
                : undefined
            }
            className="flex min-h-0 min-w-0 flex-col overflow-hidden"
            contentClassName="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
          >
            <InputGroup className="shrink-0 bg-background">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索路径…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="搜索路径"
              />
              {query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    onClick={() => setQuery("")}
                    aria-label="清除"
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>

            <DataState
              loading={files === null}
              empty={filteredFiles.length === 0}
              emptyIcon={FileText}
              emptyTitle={files?.length === 0 ? "暂无文档" : "无匹配"}
              emptyDescription={
                files?.length === 0
                  ? "点「新建」创建文档，或放入 .md / .txt 文件。"
                  : "换个关键词试试。"
              }
              skeleton={<Skeleton className="h-32 w-full" />}
            >
              {/* 原生滚动：滚动条占位，不叠在 badge/文件名上（ScrollArea 为 overlay 会遮挡） */}
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
                <div className="flex min-w-0 flex-col gap-0.5 pb-2">
                  {renderTree(tree)}
                </div>
              </div>
            </DataState>
          </SectionCard>
        }
        detail={
          active ? (
            <SectionCard
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-sm" title={active}>
                    {active}
                  </span>
                  {unsaved && (
                    <Badge variant="destructive" className="shrink-0">
                      未保存
                    </Badge>
                  )}
                  {!unsaved && dirtyDocs.has(active) && (
                    <Badge
                      variant="outline"
                      className="shrink-0 text-destructive"
                    >
                      未重建
                    </Badge>
                  )}
                </span>
              }
              icon={FileText}
              className="flex min-h-0 min-w-0 flex-col overflow-hidden"
              contentClassName="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
              action={
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={busyFs}
                    onClick={() => {
                      setRenamePath(active)
                      setRenameOpen(true)
                    }}
                  >
                    <Pencil data-icon="inline-start" />
                    重命名
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive"
                    disabled={busyFs}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 data-icon="inline-start" />
                    删除
                  </Button>
                </div>
              }
            >
              {loadingFile ? (
                <Skeleton className="min-h-40 flex-1" />
              ) : (
                <Tabs
                  value={tab}
                  onValueChange={(v) => setTab(v as typeof tab)}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <TabsList className="shrink-0">
                    <TabsTrigger value="edit">
                      <Code2 data-icon="inline-start" />
                      编辑
                    </TabsTrigger>
                    <TabsTrigger value="preview">
                      <Eye data-icon="inline-start" />
                      预览
                    </TabsTrigger>
                    <TabsTrigger value="chunks">
                      分块
                      {chunksOf(active) > 0 ? ` (${chunksOf(active)})` : ""}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="edit"
                    className="mt-2 flex min-h-0 flex-1 flex-col gap-2"
                  >
                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      className="min-h-0 flex-1 resize-none font-mono text-sm"
                      spellCheck={false}
                    />
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        onClick={() => void saveOnly()}
                        disabled={saving || ingesting || !unsaved}
                        variant="outline"
                        size="sm"
                      >
                        {saving ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Save data-icon="inline-start" />
                        )}
                        仅保存
                      </Button>
                      <Button
                        onClick={() => void saveAndIngest()}
                        disabled={saving || ingesting}
                        size="sm"
                      >
                        {saving || ingesting ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Save data-icon="inline-start" />
                        )}
                        保存并生效
                      </Button>
                      {dirty && (
                        <span className="text-xs text-muted-foreground">
                          {unsaved ? "有未保存改动" : "已保存，待重建索引"}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        {content.length.toLocaleString()} 字
                      </span>
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="preview"
                    className="mt-2 min-h-0 flex-1 overflow-hidden"
                  >
                    <ScrollArea className="h-full rounded-md border p-4">
                      <MarkdownBody source={content} />
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent
                    value="chunks"
                    className="mt-2 min-h-0 flex-1 overflow-hidden"
                  >
                    <DataState
                      loading={loadingChunks}
                      empty={chunks.length === 0}
                      emptyIcon={Boxes}
                      emptyTitle="尚无分块"
                      emptyDescription="点「保存并生效」或「重建索引」后生成。"
                      skeleton={<Skeleton className="h-40 w-full" />}
                    >
                      <ScrollArea className="h-full pr-3">
                        <div className="flex flex-col gap-2 pb-2">
                          {chunks.map((c, i) => (
                            <ItemCard
                              key={c.id}
                              meta={
                                <>
                                  <span>#{i + 1}</span>
                                  <span className="ml-auto tabular-nums">
                                    {c.content.length} 字
                                  </span>
                                </>
                              }
                            >
                              <p className="text-sm whitespace-pre-wrap">
                                {c.content}
                              </p>
                            </ItemCard>
                          ))}
                        </div>
                      </ScrollArea>
                    </DataState>
                  </TabsContent>
                </Tabs>
              )}
            </SectionCard>
          ) : (
            <SectionCard
              title="预览"
              className="flex min-h-0 min-w-0 flex-col"
              contentClassName="flex flex-1 items-center justify-center"
            >
              <EmptyState
                icon={BookOpen}
                title="未选择文件"
                description="从左侧选择文档，或点「新建」创建。"
              />
            </SectionCard>
          )
        }
      />

      {/* 新建 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建文档</DialogTitle>
            <DialogDescription>
              相对知识库根目录的路径，仅支持 .md / .txt。可含子目录，如
              faq/new.md。
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="faq/example.md"
            value={createPath}
            onChange={(e) => setCreatePath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createFile()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void createFile()} disabled={busyFs}>
              {busyFs ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名 / 移动</DialogTitle>
            <DialogDescription>
              若目标路径已存在将失败。会同步更新检索索引中的文档标识。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renamePath}
            onChange={(e) => setRenamePath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void renameFile()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void renameFile()} disabled={busyFs}>
              {busyFs ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Pencil data-icon="inline-start" />
              )}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              删除文档？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将删除文件 <span className="font-mono">{active}</span>
              ，并清除对应检索分块。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => void deleteFile()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 未保存切换确认 */}
      <AlertDialog
        open={pendingNav != null}
        onOpenChange={(o) => !o && setPendingNav(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>丢弃未保存改动？</AlertDialogTitle>
            <AlertDialogDescription>
              当前文档有未保存内容。继续将丢失这些改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>留下</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={confirmDiscard}
            >
              丢弃并继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  )
}
