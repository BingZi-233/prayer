"use client"

import type { ReactNode } from "react"
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
import { cn } from "@/lib/core/utils"
import { useKbFiles } from "@/components/admin/kb/use-kb-files"
import { countFiles, type TreeNode } from "@/components/admin/kb/tree"
import { MarkdownBody } from "@/components/admin/kb/markdown-body"

export default function KbPage() {
  const kb = useKbFiles()

  function renderTree(nodes: TreeNode[], depth = 0): ReactNode {
    return nodes.map((n) => {
      if (n.kind === "dir") {
        const open = kb.expanded.has(n.path) || !!kb.query.trim()
        return (
          <div key={`d:${n.path}`} className="min-w-0">
            <button
              type="button"
              onClick={() => kb.toggleDir(n.path)}
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
      const isActive = kb.active === n.path
      const isDirtyDoc = kb.dirtyDocs.has(n.path)
      const isUnsavedActive = isActive && kb.unsaved
      return (
        <button
          key={`f:${n.path}`}
          type="button"
          onClick={() => kb.requestOpen(n.path)}
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
          ) : kb.chunksOf(n.path) > 0 ? (
            <Badge
              variant="secondary"
              className="h-4 shrink-0 px-1 text-[10px] tabular-nums"
            >
              {kb.chunksOf(n.path)}
            </Badge>
          ) : null}
        </button>
      )
    })
  }

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
              onClick={() => {
                kb.setCreatePath(
                  kb.active?.includes("/")
                    ? kb.active.slice(0, kb.active.lastIndexOf("/") + 1)
                    : ""
                )
                kb.setCreateOpen(true)
              }}
            >
              <Plus data-icon="inline-start" />
              新建
            </Button>
            <Button
              variant="secondary"
              onClick={() => void kb.ingest()}
              disabled={kb.ingesting}
            >
              {kb.ingesting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {kb.ingesting ? "重建中…" : "重建索引"}
            </Button>
          </div>
        }
      />

      {kb.stats && (
        <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {kb.stats.docs.length} 个文档 · {kb.stats.chunks} 个分块 · 已索引{" "}
          {kb.stats.vecs} · 维度 {kb.stats.dim}
        </p>
      )}

      {kb.unsaved && (
        <Notice
          variant="warning"
          title="当前文档有未保存改动"
          description="按 ⌘/Ctrl+S 仅保存，或在编辑页「保存并生效」写入并重建索引。"
          className="shrink-0"
        />
      )}
      {kb.orphan !== 0 && (
        <Notice
          variant="warning"
          title={`${kb.orphan} 个分块缺少向量`}
          description="需要点右上角「重建索引」补齐检索向量。"
          className="shrink-0"
        />
      )}
      {kb.dirtyDocs.size > 0 && (
        <Notice
          variant="warning"
          title={`${kb.dirtyDocs.size} 个文档已改未重建`}
          description={`${Array.from(kb.dirtyDocs).join(", ")} —— 检索索引仍是旧内容。`}
          className="shrink-0"
        />
      )}

      <MasterDetail
        selected={!!kb.active}
        onBack={kb.closeFile}
        breakpoint="md"
        listWidth="280px"
        backLabel="返回文件列表"
        className="min-h-0 flex-1"
        list={
          <SectionCard
            title="文件"
            description={
              kb.files
                ? `${kb.filteredFiles.length}${kb.query ? ` / ${kb.files.length}` : ""} 个`
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
                value={kb.query}
                onChange={(e) => kb.setQuery(e.target.value)}
                aria-label="搜索路径"
              />
              {kb.query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    onClick={() => kb.setQuery("")}
                    aria-label="清除"
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>

            <DataState
              loading={kb.files === null}
              empty={kb.filteredFiles.length === 0}
              emptyIcon={FileText}
              emptyTitle={kb.files?.length === 0 ? "暂无文档" : "无匹配"}
              emptyDescription={
                kb.files?.length === 0
                  ? "点「新建」创建文档，或放入 .md / .txt 文件。"
                  : "换个关键词试试。"
              }
              skeleton={<Skeleton className="h-32 w-full" />}
            >
              {/* 原生滚动：滚动条占位，不叠在 badge/文件名上（ScrollArea 为 overlay 会遮挡） */}
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
                <div className="flex min-w-0 flex-col gap-0.5 pb-2">
                  {renderTree(kb.tree)}
                </div>
              </div>
            </DataState>
          </SectionCard>
        }
        detail={
          kb.active ? (
            <SectionCard
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="truncate font-mono text-sm"
                    title={kb.active}
                  >
                    {kb.active}
                  </span>
                  {kb.unsaved && (
                    <Badge variant="destructive" className="shrink-0">
                      未保存
                    </Badge>
                  )}
                  {!kb.unsaved && kb.dirtyDocs.has(kb.active) && (
                    <Badge
                      variant="outline"
                      className="shrink-0 text-destructive"
                    >
                      未重建
                    </Badge>
                  )}
                </span>
              }
              className="flex min-h-0 min-w-0 flex-col overflow-hidden"
              contentClassName="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
              action={
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={kb.busyFs}
                    onClick={() => {
                      kb.setRenamePath(kb.active!)
                      kb.setRenameOpen(true)
                    }}
                  >
                    <Pencil data-icon="inline-start" />
                    重命名
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive"
                    disabled={kb.busyFs}
                    onClick={() => kb.setDeleteOpen(true)}
                  >
                    <Trash2 data-icon="inline-start" />
                    删除
                  </Button>
                </div>
              }
            >
              {kb.loadingFile ? (
                <Skeleton className="min-h-40 flex-1" />
              ) : (
                <Tabs
                  value={kb.tab}
                  onValueChange={(v) => kb.setTab(v as typeof kb.tab)}
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
                      {kb.chunksOf(kb.active) > 0
                        ? ` (${kb.chunksOf(kb.active)})`
                        : ""}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="edit"
                    className="mt-2 flex min-h-0 flex-1 flex-col gap-2"
                  >
                    <Textarea
                      value={kb.content}
                      onChange={(e) => kb.setContent(e.target.value)}
                      className="min-h-0 flex-1 resize-none font-mono text-sm"
                      spellCheck={false}
                    />
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        onClick={() => void kb.saveOnly()}
                        disabled={kb.saving || kb.ingesting || !kb.unsaved}
                        variant="outline"
                        size="sm"
                      >
                        {kb.saving ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Save data-icon="inline-start" />
                        )}
                        仅保存
                      </Button>
                      <Button
                        onClick={() => void kb.saveAndIngest()}
                        disabled={kb.saving || kb.ingesting}
                        size="sm"
                      >
                        {kb.saving || kb.ingesting ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Save data-icon="inline-start" />
                        )}
                        保存并生效
                      </Button>
                      {kb.dirty && (
                        <span className="text-xs text-muted-foreground">
                          {kb.unsaved ? "有未保存改动" : "已保存，待重建索引"}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        {kb.content.length.toLocaleString()} 字
                      </span>
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="preview"
                    className="mt-2 min-h-0 flex-1 overflow-hidden"
                  >
                    <ScrollArea className="h-full rounded-md border p-4">
                      <MarkdownBody source={kb.content} />
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent
                    value="chunks"
                    className="mt-2 min-h-0 flex-1 overflow-hidden"
                  >
                    <DataState
                      loading={kb.loadingChunks}
                      empty={kb.chunks.length === 0}
                      emptyIcon={Boxes}
                      emptyTitle="尚无分块"
                      emptyDescription="点「保存并生效」或「重建索引」后生成。"
                      skeleton={<Skeleton className="h-40 w-full" />}
                    >
                      <ScrollArea className="h-full pr-3">
                        <div className="flex flex-col gap-2 pb-2">
                          {kb.chunks.map((c, i) => (
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
      <Dialog open={kb.createOpen} onOpenChange={kb.setCreateOpen}>
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
            value={kb.createPath}
            onChange={(e) => kb.setCreatePath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void kb.createFile()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => kb.setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void kb.createFile()} disabled={kb.busyFs}>
              {kb.busyFs ? (
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
      <Dialog open={kb.renameOpen} onOpenChange={kb.setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名 / 移动</DialogTitle>
            <DialogDescription>
              若目标路径已存在将失败。会同步更新检索索引中的文档标识。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={kb.renamePath}
            onChange={(e) => kb.setRenamePath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void kb.renameFile()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => kb.setRenameOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void kb.renameFile()} disabled={kb.busyFs}>
              {kb.busyFs ? (
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
      <AlertDialog open={kb.deleteOpen} onOpenChange={kb.setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              删除文档？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将删除文件 <span className="font-mono">{kb.active}</span>
              ，并清除对应检索分块。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => void kb.deleteFile()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 未保存切换确认 */}
      <AlertDialog
        open={kb.pendingNav != null}
        onOpenChange={(o) => !o && kb.setPendingNav(null)}
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
              onClick={kb.confirmDiscard}
            >
              丢弃并继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  )
}
