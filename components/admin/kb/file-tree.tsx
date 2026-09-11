import type { ReactNode } from "react"
import {
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  X,
} from "lucide-react"
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
  files,
  filteredFiles,
  query,
  setQuery,
  expanded,
  active,
  dirtyDocs,
  unsaved,
  tree,
  chunksOf,
  onOpen,
  onToggleDir,
}: FileTreeProps) {
  function renderTree(nodes: TreeNode[], depth = 0): ReactNode {
    return nodes.map((n) => {
      if (n.kind === "dir") {
        const open = expanded.has(n.path) || !!query.trim()
        return (
          <div key={`d:${n.path}`} className="min-w-0">
            <button
              type="button"
              onClick={() => onToggleDir(n.path)}
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
          onClick={() => onOpen(n.path)}
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

  return (
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
  )
}
