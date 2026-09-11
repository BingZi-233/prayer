"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
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
import type { Data } from "@/components/admin/reflection/types"
import { MetricRows } from "@/components/admin/stat"
import { SectionCard } from "@/components/admin/section-card"
import { DataState } from "@/components/admin/data-state"
import { usePolling } from "@/components/admin/use-polling"
import { useGroupNames } from "@/lib/core/chat/group-name"
import { formatDuration } from "@/lib/core/format-duration"

export default function ReflectionPage() {
  const {
    data: d,
    error,
    loading,
    refresh,
  } = usePolling<Data>("/api/reflection")
  const { name } = useGroupNames()
  const [busy, setBusy] = useState(false)
  const [promoteBusy, setPromoteBusy] = useState(false)
  const [acting, setActing] = useState<number | null>(null)
  // 3s 轮询 + 操作都会触发 render:计数只随数据变化重算
  const { entryCount, approvedCount } = useMemo(() => {
    const es = d?.entries ?? []
    return {
      entryCount: es.length,
      approvedCount: es.filter((e) => (e.status ?? "approved") === "approved")
        .length,
    }
  }, [d])
  const willCompact = d ? approvedCount >= d.config.compactMinEntries : false
  const willPromote = d
    ? approvedCount >= d.config.promoteMinEntries && d.config.promoteMs > 0
    : false

  async function compact() {
    setBusy(true)
    try {
      const r = await fetch("/api/reflection/compact", { method: "POST" }).then(
        (x) => x.json()
      )
      if (r.ok) {
        toast.success(
          r.data.ran
            ? `已整理:${r.data.before} → ${r.data.after} 条`
            : "整理完成:无变化(未达阈值或结果不变)"
        )
      } else {
        toast.error(`整理失败:${r.error}`)
      }
    } catch (e) {
      toast.error(`整理失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await refresh({ force: true })
      setBusy(false)
    }
  }

  async function autoPromote() {
    setPromoteBusy(true)
    try {
      const r = await fetch("/api/reflection/promote", { method: "POST" }).then(
        (x) => x.json()
      )
      if (r.ok) {
        toast.success(
          r.data.promoted > 0
            ? `自动升格:评审 ${r.data.considered} 条,升格 ${r.data.promoted} 条`
            : `升格评审完成:候选 ${r.data.considered} 条,无需升格`
        )
      } else {
        toast.error(`升格失败:${r.error}`)
      }
    } catch (e) {
      toast.error(`升格失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await refresh({ force: true })
      setPromoteBusy(false)
    }
  }

  async function act(id: number, action: "approve" | "reject" | "promote") {
    setActing(id)
    try {
      const r = await fetch("/api/reflection", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      }).then((x) => x.json())
      if (r.ok) {
        if (action === "promote")
          toast.success(`已升格为正式文档：${r.data.file}`)
        else toast.success(action === "approve" ? "已恢复入库" : "已驳回")
        await refresh({ force: true })
      } else toast.error(r.error || "操作失败")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(null)
    }
  }

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
