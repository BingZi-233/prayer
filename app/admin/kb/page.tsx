"use client"

import { RefreshCw, BookOpen, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { Notice } from "@/components/admin/notice"
import { MasterDetail } from "@/components/admin/master-detail"
import { EmptyState } from "@/components/admin/data-state"
import { useKbFiles } from "@/components/admin/kb/use-kb-files"
import { FileTree } from "@/components/admin/kb/file-tree"
import { EditorPanel } from "@/components/admin/kb/editor-panel"
import { FileDialogs } from "@/components/admin/kb/file-dialogs"

export default function KbPage() {
  const kb = useKbFiles()

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
              onRename={() => {
                kb.setRenamePath(kb.active!)
                kb.setRenameOpen(true)
              }}
              onDelete={() => kb.setDeleteOpen(true)}
            />
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

      <FileDialogs
        createOpen={kb.createOpen}
        setCreateOpen={kb.setCreateOpen}
        createPath={kb.createPath}
        setCreatePath={kb.setCreatePath}
        renameOpen={kb.renameOpen}
        setRenameOpen={kb.setRenameOpen}
        renamePath={kb.renamePath}
        setRenamePath={kb.setRenamePath}
        deleteOpen={kb.deleteOpen}
        setDeleteOpen={kb.setDeleteOpen}
        busyFs={kb.busyFs}
        pendingNav={kb.pendingNav}
        setPendingNav={kb.setPendingNav}
        active={kb.active}
        onCreate={() => void kb.createFile()}
        onRename={() => void kb.renameFile()}
        onDelete={() => void kb.deleteFile()}
        onConfirmDiscard={kb.confirmDiscard}
      />
    </PageShell>
  )
}
