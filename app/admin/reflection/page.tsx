"use client"

import { Brain, Sparkles } from "lucide-react"
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
import { RelativeTime } from "@/components/relative-time"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { EntryList } from "@/components/admin/reflection/entry-list"
import { useReflectionActions } from "@/components/admin/reflection/use-reflection-actions"
import { MetricRows } from "@/components/admin/stat"
import { SectionCard } from "@/components/admin/section-card"
import { DataState } from "@/components/admin/data-state"
import type { EntryStatus } from "@/components/admin/reflection/types"
import { useGroupNames } from "@/lib/core/chat/group-name"
import { formatDuration } from "@/lib/core/format-duration"

const STATUS_FILTERS: { label: string; value: EntryStatus | null }[] = [
  { label: "全部", value: null },
  { label: "待审", value: "pending" },
  { label: "已入库", value: "approved" },
  { label: "已驳回", value: "rejected" },
]

export default function ReflectionPage() {
  const {
    data: d,
    error,
    loading,
    refresh,
    promoteBusy,
    acting,
    approvedCount,
    pendingCount,
    statusFilter,
    setStatusFilter,
    willPromote,
    autoPromote,
    act,
  } = useReflectionActions()
  const { name } = useGroupNames()

  return (
    <PageShell>
      <PageHeader
        title="反思"
        description="从人工答复中提炼知识，经人工审核后入库。"
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
            label: "升格周期",
            value: d
              ? d.config.promoteMs > 0
                ? formatDuration(d.config.promoteMs)
                : "关"
              : "—",
            hint: "正式文档升格评审的周期;「关」表示停用。",
          },
          {
            label: "待审",
            value: d ? pendingCount : "—",
            hint: "新沉淀的知识默认待审,人工审核入库后才会被检索。",
            warn: pendingCount > 0,
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
        title={`知识条目${d ? ` (${d.entries.length})` : ""}`}
        description="新沉淀的知识默认待审，审核入库后 Agent 才能检索命中；已入库的可驳回，或升格为正式文档。"
        action={
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.label}
                size="sm"
                variant={statusFilter === f.value ? "default" : "outline"}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
                {f.value && d ? ` ${d.counts[f.value]}` : ""}
              </Button>
            ))}
          </div>
        }
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
