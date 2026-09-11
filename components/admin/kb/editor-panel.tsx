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

export function EditorPanel({
  active,
  content,
  setContent,
  saving,
  ingesting,
  loadingFile,
  loadingChunks,
  chunks,
  tab,
  setTab,
  unsaved,
  dirty,
  busyFs,
  chunksOf,
  onSaveOnly,
  onSaveAndIngest,
  onRename,
  onDelete,
}: EditorPanelProps) {
  return (
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
          {!unsaved && dirty && (
            <Badge variant="outline" className="shrink-0 text-destructive">
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
            disabled={busyFs}
            onClick={onRename}
          >
            <Pencil data-icon="inline-start" />
            重命名
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive"
            disabled={busyFs}
            onClick={onDelete}
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
                onClick={onSaveOnly}
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
                onClick={onSaveAndIngest}
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
                      <p className="text-sm whitespace-pre-wrap">{c.content}</p>
                    </ItemCard>
                  ))}
                </div>
              </ScrollArea>
            </DataState>
          </TabsContent>
        </Tabs>
      )}
    </SectionCard>
  )
}
