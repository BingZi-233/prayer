"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  Zap,
  Clock,
  Timer,
  Hash,
  MessageSquareReply,
  User,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { VirtualList } from "@/components/admin/virtual-list"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
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
import { MetricBadge, MetricBadgeRow } from "@/components/admin/stat"
import { SectionCard } from "@/components/admin/section-card"
import { ItemCard } from "@/components/admin/item-card"
import { DataState } from "@/components/admin/data-state"
import { usePolling } from "@/components/admin/use-polling"
import { useGroupNames } from "@/lib/group-name"

interface GroupRow {
  groupId: number
  enabled: boolean
  proactiveEnabled?: boolean
  cursor: number
  lagMs: number | null
  replyCount: number
  lastReplyTs: number | null
}
interface Reply {
  id: number
  groupId: number
  userId: number
  question: string
  answer: string
  quality: "ok" | "bad" | null
  ts: number
}
interface Data {
  config: {
    enabled: boolean
    scanMs: number
    silenceMs: number
    maxPerScan: number
  }
  total: number
  groups: GroupRow[]
  replies: Reply[]
}

// 秒级配置也要可读:< 60s 显示秒,否则分
const min = (ms: number) =>
  ms < 60_000 ? `${Math.round(ms / 1000)} 秒` : `${Math.round(ms / 60000)} 分`

export default function ProactivePage() {
  const {
    data: d,
    error,
    loading,
    refresh,
  } = usePolling<Data>("/api/proactive")
  const { name } = useGroupNames()
  const [busy, setBusy] = useState(false)
  const [marking, setMarking] = useState<number | null>(null)

  async function toggleGlobal(enabled: boolean) {
    setBusy(true)
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proactiveEnabled: enabled }),
      }).then((x) => x.json())
      if (r.ok) {
        toast.success(enabled ? "已启用主动回复" : "已关闭主动回复")
        await refresh({ force: true })
      } else toast.error(r.error || "保存失败")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function mark(id: number, quality: "ok" | "bad") {
    setMarking(id)
    try {
      const r = await fetch("/api/proactive", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, quality }),
      }).then((x) => x.json())
      if (r.ok) {
        toast.success(quality === "ok" ? "已标为恰当" : "已标为不当")
        await refresh({ force: true })
      } else toast.error(r.error || "标记失败")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setMarking(null)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="主动回复"
        description="生效群里有人提问且长时间无人应答时，机器人会谨慎补位。"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">全局开关</span>
            <Switch
              checked={!!d?.config.enabled}
              disabled={busy || !d}
              onCheckedChange={(v) => toggleGlobal(v)}
            />
          </div>
        }
      />

      <MetricBadgeRow>
        <MetricBadge
          icon={Zap}
          label="状态"
          loading={loading}
          value={!d ? "—" : d.config.enabled ? "已启用" : "已关闭"}
          tone={d?.config.enabled ? "primary" : undefined}
        />
        <MetricBadge
          icon={Timer}
          label="静默阈值"
          value={d ? min(d.config.silenceMs) : "—"}
          loading={loading}
        />
        <MetricBadge
          icon={Clock}
          label="扫描周期"
          value={d ? min(d.config.scanMs) : "—"}
          loading={loading}
        />
        <MetricBadge
          icon={Hash}
          label="单次上限"
          value={d ? d.config.maxPerScan : "—"}
          loading={loading}
        />
      </MetricBadgeRow>

      <SectionCard
        title="每群进度"
        description="各生效群的扫描进度与补位次数。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.groups.length === 0}
          onRetry={refresh}
          emptyIcon={Zap}
          emptyTitle="暂无生效群"
          emptyDescription="在配置页选择生效群并启用主动回复后，进度会显示在这里。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <TableShell minWidth="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>群</TableHead>
                <TableHead>生效</TableHead>
                <TableHead>主动</TableHead>
                <TableHead>上次扫描</TableHead>
                <TableHead className="text-right">滞后</TableHead>
                <TableHead className="text-right">主动回复数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d?.groups.map((g) => (
                <TableRow key={g.groupId}>
                  <TableCell className="font-medium">
                    {name(g.groupId)}
                  </TableCell>
                  <TableCell>
                    {g.enabled ? (
                      <Badge variant="default">生效</Badge>
                    ) : (
                      <Badge variant="outline">未生效</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {(g.proactiveEnabled ?? d.config.enabled) ? (
                      <Badge variant="default">开</Badge>
                    ) : (
                      <Badge variant="outline">关</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {g.cursor === 0 ? "未扫描" : <RelativeTime ts={g.cursor} />}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.lagMs == null
                      ? "未扫描"
                      : g.lagMs > 0
                        ? min(g.lagMs)
                        : "0"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.replyCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableShell>
        </DataState>
      </SectionCard>

      <SectionCard
        icon={MessageSquareReply}
        title={`最近主动回复${d ? ` (${d.total})` : ""}`}
        description="可标记回复是否恰当，便于后续优化。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.replies.length === 0}
          onRetry={refresh}
          emptyIcon={MessageSquareReply}
          emptyTitle="暂无主动回复"
          emptyDescription="机器人主动补位后，记录会显示在这里。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <VirtualList
            items={d?.replies ?? []}
            getKey={(e) => e.id}
            gap={12}
            className="h-[400px] pr-3"
            renderItem={(e) => (
              <ItemCard
                meta={
                  <>
                    <Badge variant="secondary">{name(e.groupId)}</Badge>
                    <span className="flex items-center gap-1">
                      <User className="size-3" />
                      {e.userId}
                    </span>
                    <RelativeTime ts={e.ts} />
                    {e.quality === "ok" && (
                      <Badge variant="default">恰当</Badge>
                    )}
                    {e.quality === "bad" && (
                      <Badge variant="destructive">不当</Badge>
                    )}
                    <span className="ml-auto flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={marking === e.id}
                        onClick={() => mark(e.id, "ok")}
                        aria-label="标为恰当"
                        title="恰当"
                      >
                        <ThumbsUp data-icon="inline-start" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={marking === e.id}
                        onClick={() => mark(e.id, "bad")}
                        aria-label="标为不当"
                        title="不当"
                      >
                        <ThumbsDown data-icon="inline-start" />
                      </Button>
                    </span>
                  </>
                }
              >
                <p className="mb-1.5 line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground">
                  问:{e.question}
                </p>
                <p className="text-sm whitespace-pre-wrap">{e.answer}</p>
              </ItemCard>
            )}
          />
        </DataState>
      </SectionCard>
    </PageShell>
  )
}
