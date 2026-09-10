"use client"

import { useState } from "react"
import { TrendingUp, ShieldCheck, ShieldAlert } from "lucide-react"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { StatCard, StatGrid } from "@/components/admin/stat"
import { DataState } from "@/components/admin/data-state"
import { usePolling } from "@/components/admin/use-polling"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableShell } from "@/components/admin/table-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RelativeTime } from "@/components/relative-time"

type Win = "7d" | "30d" | "all"
interface Topic {
  id: number
  title: string
  count: number
  kbCovered: boolean | null // null = 未评估(TOP_KB 之外)
  kbDistance: number | null
  lastTs: number
  samples: string[]
}
interface Data {
  window: string
  totals: { topics: number; questions: number; gaps: number }
  topics: Topic[]
}

const WINDOWS: { key: Win; label: string }[] = [
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "all", label: "全部" },
]

export default function RankingPage() {
  const [win, setWin] = useState<Win>("7d")
  const {
    data: d,
    error,
    loading,
    refresh,
  } = usePolling<Data>(`/api/ranking?window=${win}`, 30_000)

  return (
    <PageShell>
      <PageHeader
        title="问题排行榜"
        description="用户高频提问归并排名,旁标知识库覆盖,辅助针对性补文档;命中提示来自知识库向量近邻。"
        actions={
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <Button
                key={w.key}
                size="sm"
                variant={win === w.key ? "default" : "outline"}
                onClick={() => setWin(w.key)}
              >
                {w.label}
              </Button>
            ))}
          </div>
        }
      />

      <StatGrid className="xl:grid-cols-3">
        <StatCard
          label="主题数"
          value={d ? d.totals.topics : "—"}
          hint="窗口内提问归并后的主题数量。"
          loading={loading}
        />
        <StatCard
          label="窗口内提问"
          value={d ? d.totals.questions : "—"}
          hint="归并前的原始提问总数。"
          loading={loading}
        />
        <StatCard
          label="疑似盲区"
          value={d ? d.totals.gaps : "—"}
          hint="知识库未覆盖的高频问题,优先补文档。"
          warn={Boolean(d && d.totals.gaps > 0)}
          loading={loading}
        />
      </StatGrid>

      <DataState
        loading={loading}
        error={error}
        empty={!d || d.topics.length === 0}
        onRetry={refresh}
        emptyIcon={TrendingUp}
        emptyTitle="暂无排行数据"
        emptyDescription="用户提问经归类后会出现在这里(随运行逐步积累)。"
        skeleton={<Skeleton className="h-60 w-full" />}
      >
        <TableShell minWidth="min-w-[560px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>主题</TableHead>
              <TableHead className="text-right">提问数</TableHead>
              <TableHead>知识库</TableHead>
              <TableHead className="text-right">最近提问</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d?.topics.map((t, i) => (
              <TableRow key={t.id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {i + 1}
                </TableCell>
                <TableCell>
                  <details>
                    <summary className="cursor-pointer font-medium">
                      {t.title}
                    </summary>
                    <div className="mt-1.5 flex flex-col gap-1 border-l-2 pl-2 text-xs text-muted-foreground">
                      {t.samples.map((s, j) => (
                        <p key={j} className="whitespace-pre-wrap">
                          {s}
                        </p>
                      ))}
                    </div>
                  </details>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {t.count}
                </TableCell>
                <TableCell>
                  {t.kbCovered === null ? (
                    <Badge variant="outline">未评估</Badge>
                  ) : t.kbCovered ? (
                    <Badge variant="secondary">
                      <ShieldCheck data-icon="inline-start" />
                      已覆盖
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <ShieldAlert data-icon="inline-start" />
                      疑似盲区
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  <RelativeTime ts={t.lastTs} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableShell>
      </DataState>
    </PageShell>
  )
}
