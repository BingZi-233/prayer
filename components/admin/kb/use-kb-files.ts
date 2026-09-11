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

  const orphan = stats ? stats.chunks - stats.vecs : 0

  return {
    files,
    active,
    content,
    setContent,
    savedContent,
    saving,
    ingesting,
    stats,
    chunks,
    loadingChunks,
    loadingFile,
    dirtyDocs,
    query,
    setQuery,
    expanded,
    tab,
    setTab,
    createOpen,
    setCreateOpen,
    createPath,
    setCreatePath,
    renameOpen,
    setRenameOpen,
    renamePath,
    setRenamePath,
    deleteOpen,
    setDeleteOpen,
    busyFs,
    pendingNav,
    setPendingNav,
    unsaved,
    dirty,
    filteredFiles,
    tree,
    orphan,
    requestOpen,
    closeFile,
    confirmDiscard,
    saveOnly,
    ingest,
    saveAndIngest,
    createFile,
    renameFile,
    deleteFile,
    toggleDir,
    chunksOf,
  }
}
