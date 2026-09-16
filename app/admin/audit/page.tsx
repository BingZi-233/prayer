"use client"

import { RefreshCw, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { RelativeTime } from "@/components/relative-time"
import { DataState, EmptyState } from "@/components/admin/data-state"
import { Notice } from "@/components/admin/notice"
import { PageHeader } from "@/components/admin/page-header"
import { PageShell } from "@/components/admin/page-shell"
import { MetricRows } from "@/components/admin/stat"
import { TableShell } from "@/components/admin/table-shell"
import { usePolling } from "@/components/admin/use-polling"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"

type AuditResult = "started" | "accepted" | "rejected" | "failed" | "partial"

type AuditEvent = {
  id: number
  requestId: string
  actorType: "shared-admin-token" | "development-unprotected"
  action: string
  route: string
  method: "POST" | "PUT" | "PATCH" | "DELETE"
  result: AuditResult
  httpStatus: number | null
  startedAt: number
  finishedAt: number | null
}

type AuditData = {
  limit: number
  recent: AuditEvent[]
  unfinished: AuditEvent[]
  unfinishedCount: number
}

const outcome = {
  started: {
    label: "未结束",
    className:
      "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  },
  accepted: {
    label: "已完成",
    className:
      "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  },
  rejected: { label: "已拒绝", className: "" },
  failed: { label: "失败", className: "" },
  partial: {
    label: "部分完成",
    className:
      "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  },
} as const

function OutcomeBadge({ result }: { result: AuditResult }) {
  const item = outcome[result]
  return (
    <Badge
      variant={result === "failed" ? "destructive" : "outline"}
      className={item.className}
    >
      {item.label}
    </Badge>
  )
}

function actorLabel(actorType: AuditEvent["actorType"]): string {
  return actorType === "shared-admin-token"
    ? "共享管理员令牌"
    : "开发未保护模式"
}

function AuditTable({
  events,
  label,
}: {
  events: AuditEvent[]
  label: string
}) {
  return (
    <TableShell minWidth="min-w-[1040px]">
      <caption className="sr-only">{label}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>开始时间（本地）</TableHead>
          <TableHead>结束时间（本地）</TableHead>
          <TableHead>操作</TableHead>
          <TableHead>结果</TableHead>
          <TableHead className="text-right">HTTP</TableHead>
          <TableHead>授权模型</TableHead>
          <TableHead>关联 ID</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="text-muted-foreground">
              <RelativeTime ts={event.startedAt} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              <RelativeTime ts={event.finishedAt} />
            </TableCell>
            <TableCell>
              <p className="font-medium">{event.action}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {event.method} {event.route}
              </p>
            </TableCell>
            <TableCell>
              <OutcomeBadge result={event.result} />
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {event.httpStatus ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {actorLabel(event.actorType)}
            </TableCell>
            <TableCell>
              <code className="font-mono text-[11px] text-muted-foreground">
                {event.requestId}
              </code>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

export default function AuditPage() {
  const { data, error, loading, refresh } = usePolling<AuditData>(
    "/api/audit",
    30_000
  )
  const [refreshing, setRefreshing] = useState(false)
  const completed = data?.recent.filter((event) => event.result !== "started")
  const needsReview = completed?.filter(
    (event) => event.result === "partial" || event.result === "failed"
  ).length

  async function refreshNow() {
    setRefreshing(true)
    try {
      await refresh({ force: true })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="管理审计"
        description="查看有限窗口内的管理变更轨迹。授权模型描述认证方式，不代表真实操作人。"
        actions={
          <Button
            variant="secondary"
            onClick={() => void refreshNow()}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            {refreshing ? (
              <Spinner aria-label="正在刷新审计记录" data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            刷新
          </Button>
        }
      />

      <MetricRows
        items={[
          {
            label: "可见最近记录",
            value: data ? `${data.recent.length} / ${data.limit}` : "—",
            hint: "接口只返回最近的有限窗口，不代表全量历史。",
          },
          {
            label: "未结束",
            value: data?.unfinishedCount ?? "—",
            warn: Boolean(data && data.unfinishedCount > 0),
            hint: "包含全部未结束事件的总数；下方最多展示 100 条。",
          },
          {
            label: "本窗口需复核",
            value: needsReview ?? "—",
            warn: Boolean(needsReview),
            hint: "部分完成或失败的终结记录，需要结合运行日志继续判断。",
          },
        ]}
      />

      <DataState
        loading={loading}
        error={data ? null : error}
        empty={Boolean(
          data && data.recent.length === 0 && data.unfinished.length === 0
        )}
        onRetry={refresh}
        emptyIcon={ShieldCheck}
        emptyTitle="暂无管理审计记录"
        emptyDescription="完成一次已纳入审计的管理变更后，记录会出现在这里。"
        skeleton={<Skeleton className="h-72 w-full" />}
      >
        <div className="flex flex-col gap-6">
          {data && error && (
            <Notice
              variant="warning"
              title="暂时无法刷新审计记录"
              description={`${error}。下方保留的是上次成功读取的数据。`}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshNow()}
                disabled={refreshing}
                aria-busy={refreshing}
              >
                {refreshing ? (
                  <Spinner
                    aria-label="正在重新尝试读取审计记录"
                    data-icon="inline-start"
                  />
                ) : null}
                重新尝试
              </Button>
            </Notice>
          )}

          {data && data.unfinishedCount > 0 && (
            <Notice
              variant="warning"
              title={`有 ${data.unfinishedCount} 条未结束审计事件`}
              description="它可能仍在执行，也可能在变更后中断或审计终结写入失败。先核对下方关联 ID、运行日志和实际业务状态，再决定是否重试。"
            />
          )}

          {data && data.unfinished.length > 0 && (
            <section aria-labelledby="unfinished-audit-heading">
              <div className="mb-3">
                <h2
                  id="unfinished-audit-heading"
                  className="text-sm font-medium"
                >
                  未结束的变更
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  以下为最近的未结束事件；它们不会在下方最近终结记录中重复出现。
                </p>
              </div>
              <AuditTable events={data.unfinished} label="未结束的管理变更" />
            </section>
          )}

          <section aria-labelledby="recent-audit-heading">
            <div className="mb-3">
              <h2 id="recent-audit-heading" className="text-sm font-medium">
                最近终结记录
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                仅显示本次读取窗口中的已终结事件；HTTP
                结果反映接口返回，不保证跨文件、进程或远端副作用原子完成。
              </p>
            </div>
            {completed && completed.length > 0 ? (
              <AuditTable events={completed} label="最近终结的管理变更" />
            ) : (
              <EmptyState
                icon={ShieldCheck}
                title="暂无终结记录"
                description="未结束事件会单独显示；完成一次管理变更后，终结结果会出现在这里。"
              />
            )}
          </section>
        </div>
      </DataState>
    </PageShell>
  )
}
