"use client"

import { Brain, GitCompareArrows, Wand2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableShell } from "@/components/admin/table-shell"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { RelativeTime } from "@/components/relative-time"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { CompactionRow } from "@/components/admin/reflection/compaction-row"
import { EntryList } from "@/components/admin/reflection/entry-list"
import { useReflectionActions } from "@/components/admin/reflection/use-reflection-actions"
import { MetricRows } from "@/components/admin/stat"
import { SectionCard } from "@/components/admin/section-card"
import { DataState } from "@/components/admin/data-state"
import { useGroupNames } from "@/lib/core/chat/group-name"
import { formatDuration } from "@/lib/core/format-duration"

export default function ReflectionPage() {
  const {
    data: d,
    error,
    loading,
    refresh,
    busy,
    promoteBusy,
    acting,
    entryCount,
    approvedCount,
    willCompact,
    willPromote,
    compact,
    autoPromote,
    act,
  } = useReflectionActions()
  const { name } = useGroupNames()

  return (
    <PageShell>
      <PageHeader
        title="反思"
        description="从人工答复中提炼知识，自动写入知识库。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={promoteBusy || !willPromote}
              onClick={() => void autoPromote()}
            >
              {promoteBusy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Sparkles data-icon="inline-start" />
              )}
              {promoteBusy ? "升格评审中…" : "立即升格评审"}
            </Button>
            <Dialog>
              <DialogTrigger
                render={
                  <Button disabled={busy || !willCompact} variant="outline" />
                }
              >
                {busy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Wand2 data-icon="inline-start" />
                )}
                {busy ? "整理中…" : "立即整理"}
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>立即整理反思条目</DialogTitle>
                  <DialogDescription>
                    对当前 {entryCount}{" "}
                    条知识做一次近义去重合并（保留细节，不因基础文档已覆盖而删除）。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    取消
                  </DialogClose>
                  <DialogClose
                    render={<Button onClick={compact} disabled={busy} />}
                  >
                    确认整理
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <MetricRows
        items={[
          {
            label: "扫描周期",
            value: d ? formatDuration(d.config.scanMs) : "—",
            hint: "后台扫描生效会话的间隔。",
          },
          {
            label: "静置等待",
            value: d ? formatDuration(d.config.settleMs) : "—",
            hint: "人工答复后静置多久才提炼,避免打断进行中的对话。",
          },
          {
            label: "回溯范围",
            value: d ? formatDuration(d.config.lookbackMs) : "—",
            hint: "最多回看多久内的对话。",
          },
          {
            label: "窗口上限",
            value: d ? d.config.windowMax : "—",
            hint: "单轮提炼的对话条数上限。",
          },
          {
            label: "整理周期",
            value: d ? formatDuration(d.config.compactMs) : "—",
            hint: "近义去重合并的自动执行周期。",
          },
          {
            label: "可整理 / 门槛",
            value: d ? `${approvedCount}/${d.config.compactMinEntries}` : "—",
            hint: "已入库条目数与触发整理的门槛。",
          },
          {
            label: "升格周期",
            value: d
              ? d.config.promoteMs > 0
                ? formatDuration(d.config.promoteMs)
                : "关"
              : "—",
            hint: "正式文档升格评审的周期;「关」表示停用。",
          },
          {
            label: "待升格候选",
            value: d ? `${approvedCount}/${d.config.promoteMinEntries}` : "—",
            hint: "已入库条目数与升格评审门槛。",
          },
        ]}
      />

      <SectionCard
        title="每群反思进度"
        description="各生效群的扫描与入库进度。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.groups.length === 0}
          onRetry={refresh}
          emptyIcon={Brain}
          emptyTitle="暂无进度"
          emptyDescription="生效群出现人工答复后，进度会显示在这里。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <TableShell minWidth="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>群</TableHead>
                <TableHead>上次扫描</TableHead>
                <TableHead className="text-right">滞后</TableHead>
                <TableHead className="text-right">缓冲消息</TableHead>
                <TableHead className="text-right">已入库</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d?.groups.map((g) => (
                <TableRow key={g.groupId}>
                  <TableCell className="font-medium">
                    {name(g.groupId)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime ts={g.cursor} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.lagMs == null
                      ? "未反思"
                      : g.lagMs > 0
                        ? formatDuration(g.lagMs)
                        : "0"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.bufferCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.sedimentedCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableShell>
        </DataState>
      </SectionCard>

      <SectionCard
        title={`整理记录${d ? ` (${d.compactions.length})` : ""}`}
        description="每次整理的时间与条目变化。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.compactions.length === 0}
          onRetry={refresh}
          emptyIcon={GitCompareArrows}
          emptyTitle="暂无整理记录"
          emptyDescription={`已入库条目达到门槛（${d?.config.compactMinEntries ?? "—"} 条）后按整理周期自动分批去重；阈值不是目标条数。`}
          skeleton={<Skeleton className="h-32 w-full" />}
        >
          <div className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
            {d?.compactions.map((c) => (
              <CompactionRow key={c.id} c={c} />
            ))}
          </div>
        </DataState>
      </SectionCard>

      <SectionCard
        title={`知识条目${d ? ` (${d.entries.length})` : ""}`}
        description="自动入库的自学习知识，Agent 检索可直接命中；可驳回，或升格为正式文档。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.entries.length === 0}
          onRetry={refresh}
          emptyIcon={Brain}
          emptyTitle="暂无知识条目"
          emptyDescription="提炼出的知识会出现在这里。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          {d && (
            <EntryList
              entries={d.entries}
              acting={acting}
              onAct={act}
              groupName={name}
            />
          )}
        </DataState>
      </SectionCard>
    </PageShell>
  )
}
