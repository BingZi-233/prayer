"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Activity,
  Plug,
  Users,
  RotateCw,
  TriangleAlert,
  Clock,
  LifeBuoy,
  ShieldCheck,
  Brain,
  MessagesSquare,
  Gauge,
  Target,
  Zap,
  Wrench,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RelativeTime } from "@/components/relative-time"
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
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { MetricBadge, MetricBadgeRow } from "@/components/admin/stat"
import { usePolling } from "@/components/admin/use-polling"
import {
  useLive,
  type Status,
  type ChannelStatusView,
} from "@/components/live-provider"

interface UsageRow {
  site: string
  label: string
  count: number
  cacheRead: number
  cacheCreation: number
  input: number
  output: number
  costUsd: number
  hitRatio: number
}
interface ToolRow {
  tool: string
  toolLabel: string
  runs: number
  calls: number
  perRun: number
}
interface KbCoverageView {
  totalRuns: number
  groundedRuns: number
  searchRuns: number
  prefetchRuns: number
  ratio: number
}
interface Usage {
  rows: UsageRow[]
  total: UsageRow
  daily?: { day: string; costUsd: number; budgetUsd: number } | null
  tools?: {
    day: string
    process: { rows: ToolRow[]; coverage: KbCoverageView }
    daily: { rows: ToolRow[]; coverage: KbCoverageView }
  }
}

const pct = (r: number) => `${Math.round(r * 100)}%`
const kfmt = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(2)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(Math.round(n))

/** 单元格:上为本次运行累计,下为单次调用均值(防把进程累计误读成单次量) */
function TokenCell({ total, count }: { total: number; count: number }) {
  return (
    <>
      {kfmt(total)}
      <div className="text-xs text-muted-foreground">
        均 {kfmt(total / Math.max(count, 1))}
      </div>
    </>
  )
}

const STATE_LABEL: Record<string, string> = {
  running: "运行中",
  stopped: "已停止",
  starting: "启动中",
  error: "错误",
}

function channelOf(s: Status, id: string): ChannelStatusView | undefined {
  return s.channels?.find((c) => c.id === id)
}
function channelPresent(s: Status, id: string): boolean {
  return !!channelOf(s, id)
}
function channelConnected(s: Status, id: string): boolean {
  const ch = channelOf(s, id)
  if (ch) return ch.connected && !ch.lastError
  // 无 channels 时 QQ 回退 wsConnected
  if (id === "qq") return s.wsConnected
  return false
}
function channelError(s: Status, id: string): boolean {
  return !!channelOf(s, id)?.lastError
}

export default function StatusPage() {
  // status/overview 来自全局 LiveProvider(单份轮询,本页不再重复打 /api/status、/api/overview);
  // usage 只在本页需要,走带 in-flight 闸门的 usePolling
  const { status: s, overview: ov, refresh: refreshLive } = useLive()
  const { data: usage } = usePolling<Usage>("/api/usage", 30_000)
  const [busy, setBusy] = useState(false)

  async function restart() {
    setBusy(true)
    try {
      const r = await fetch("/api/runtime/restart", { method: "POST" }).then(
        (x) => x.json()
      )
      if (r.ok) {
        toast.success("Agent 已重启")
      } else {
        toast.error(`重启失败:${r.error}`)
      }
    } catch (e) {
      toast.error(`重启失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await refreshLive()
      setBusy(false)
    }
  }

  const m = ov?.metrics
  const channelDown =
    s != null &&
    (s.channels?.length
      ? s.channels.some((c) => !c.connected || !!c.lastError)
      : !s.wsConnected)
  const hasAlerts = (ov?.humanSessions ?? 0) > 0 || channelDown

  return (
    <PageShell className="min-w-0 gap-4 lg:gap-6">
      <PageHeader
        className="shrink-0"
        title="运行状态"
        description="查看运行状态与今日业务结果。"
        actions={
          <Dialog>
            <DialogTrigger
              render={<Button disabled={busy} className="w-full sm:w-auto" />}
            >
              {busy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCw data-icon="inline-start" />
              )}
              {busy ? "重启中…" : "重启 Agent"}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>确认重启 Agent？</DialogTitle>
                <DialogDescription>
                  重启会断开当前连接并重新加载服务，进行中的会话可能中断。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  取消
                </DialogClose>
                <DialogClose
                  render={<Button onClick={restart} disabled={busy} />}
                >
                  确认重启
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {hasAlerts ? (
        <SectionCard
          className="shrink-0 border-destructive/50"
          title={
            <span className="flex items-center gap-2 text-destructive">
              <LifeBuoy className="size-4" />
              有待处理事项
            </span>
          }
          description="请尽快处理人工会话，或检查连接状态。"
          contentClassName="flex flex-wrap gap-2"
        >
          {(ov?.humanSessions ?? 0) > 0 && (
            <Button
              render={<Link href="/admin/handoff" />}
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              人工会话 {ov!.humanSessions}
            </Button>
          )}
          {s?.channels?.map(
            (c) =>
              (!c.connected || c.lastError) && (
                <Badge
                  key={c.id}
                  variant="destructive"
                  className="h-auto max-w-full justify-start whitespace-normal break-words py-1 text-left"
                >
                  {c.id.toUpperCase()} {c.lastError ? "异常" : "未连接"}
                  {c.lastError ? ` · ${c.lastError.slice(0, 40)}` : ""}
                </Badge>
              )
          )}
          {!s?.channels?.length && s && !s.wsConnected && (
            <Badge variant="destructive">WS 未连接</Badge>
          )}
        </SectionCard>
      ) : null}

      <MetricBadgeRow className="shrink-0">
        <MetricBadge
          icon={Activity}
          label="状态"
          loading={!s}
          value={s ? (STATE_LABEL[s.state] ?? s.state) : "—"}
          warn={s?.state === "error"}
          tone={s?.state === "running" ? "primary" : undefined}
        />
        <MetricBadge
          icon={Plug}
          label="QQ"
          loading={!s}
          value={s ? (channelConnected(s, "qq") ? "已连接" : "断开") : "—"}
          warn={!!s && !channelConnected(s, "qq")}
          tone={s && channelConnected(s, "qq") ? "primary" : undefined}
        />
        <MetricBadge
          icon={Plug}
          label="TG"
          loading={!s}
          value={
            !s
              ? "—"
              : !channelPresent(s, "tg")
                ? "未配置"
                : channelConnected(s, "tg")
                  ? "已连接"
                  : channelError(s, "tg")
                    ? "异常"
                    : "断开"
          }
          warn={!!s && channelPresent(s, "tg") && !channelConnected(s, "tg")}
          tone={s && channelConnected(s, "tg") ? "primary" : undefined}
        />
        <MetricBadge
          icon={Users}
          label="活动会话"
          loading={!s}
          value={s?.sessionCount ?? "—"}
        />
        <MetricBadge
          icon={ShieldCheck}
          label="生效会话"
          loading={!ov}
          value={ov?.enabledChats ?? "—"}
        />
        <MetricBadge
          icon={Brain}
          label="知识条目"
          loading={!ov}
          value={ov?.reflectionCount ?? "—"}
        />
        <MetricBadge
          icon={Target}
          label="自动解决率"
          loading={!ov}
          value={
            m?.autoResolutionRate != null ? pct(m.autoResolutionRate) : "—"
          }
        />
      </MetricBadgeRow>

      <SectionCard
        className="shrink-0"
        title="今日结果"
        icon={Target}
        description="今日 0 点起累计。自动解决率 = 自动答 ÷ (自动答 + 主动补位 + 转人工 + 错误)。"
        contentClassName="flex flex-wrap gap-2"
      >
        {!m ? (
          <>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </>
        ) : (
          <>
            <MetricBadge icon={MessagesSquare} label="自动答" value={m.auto} />
            <MetricBadge icon={Zap} label="主动补位" value={m.proactive} />
            <MetricBadge
              icon={LifeBuoy}
              label="转人工"
              value={m.handoff}
              warn={m.handoff > 0}
            />
            <MetricBadge
              icon={TriangleAlert}
              label="错误"
              value={m.error}
              warn={m.error > 0}
            />
            <MetricBadge
              icon={ShieldCheck}
              label="意图拦截"
              value={m.blocked}
            />
            <MetricBadge
              icon={Zap}
              label="主动跳过"
              value={m.proactiveSilent}
            />
            <MetricBadge
              icon={TriangleAlert}
              label="标为不当"
              value={m.proactiveBad}
              warn={m.proactiveBad > 0}
            />
            <MetricBadge
              icon={Gauge}
              label="今日成本"
              value={
                <>
                  ${m.usageCostUsd.toFixed(4)}
                  {m.usageBudgetUsd > 0 && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      / ${m.usageBudgetUsd}
                    </span>
                  )}
                </>
              }
            />
          </>
        )}
      </SectionCard>

      <SectionCard
        title="模型用量"
        icon={Gauge}
        description={
          usage?.daily
            ? `本次运行累计（token 列下方为单次调用均值）；今日已记账 $${usage.daily.costUsd.toFixed(4)}${usage.daily.budgetUsd > 0 ? ` / 预算 $${usage.daily.budgetUsd}` : ""}。`
            : "按调用点统计本次运行用量，token 列下方为单次调用均值。重启后内存计数清零，日汇总仍保留。"
        }
        action={
          usage ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="tabular-nums">
                命中 {pct(usage.total.hitRatio)}
              </Badge>
              <Badge variant="outline" className="tabular-nums">
                ${usage.total.costUsd.toFixed(4)}
              </Badge>
              <Badge variant="outline" className="tabular-nums">
                {usage.total.count} 次
              </Badge>
            </div>
          ) : undefined
        }
      >
        {!usage ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>调用点</TableHead>
                <TableHead className="text-right">次数</TableHead>
                <TableHead className="text-right">命中率</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  缓存命中/写入
                </TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  未缓存输入
                </TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  输出
                </TableHead>
                <TableHead className="text-right">成本($)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.rows.map((r) => (
                <TableRow key={r.site}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {r.label}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.count}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={r.hitRatio >= 0.8 ? "default" : "secondary"}
                    >
                      {pct(r.hitRatio)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {kfmt(r.cacheRead)} / {kfmt(r.cacheCreation)}
                    <div className="text-xs text-muted-foreground">
                      均 {kfmt(r.cacheRead / Math.max(r.count, 1))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    <TokenCell total={r.input} count={r.count} />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    <TokenCell total={r.output} count={r.count} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.costUsd.toFixed(4)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>合计</TableCell>
                <TableCell className="text-right tabular-nums">
                  {usage.total.count}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary">{pct(usage.total.hitRatio)}</Badge>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {kfmt(usage.total.cacheRead)} /{" "}
                  {kfmt(usage.total.cacheCreation)}
                  <div className="text-xs font-normal text-muted-foreground">
                    均{" "}
                    {kfmt(
                      usage.total.cacheRead / Math.max(usage.total.count, 1)
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  <TokenCell
                    total={usage.total.input}
                    count={usage.total.count}
                  />
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  <TokenCell
                    total={usage.total.output}
                    count={usage.total.count}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usage.total.costUsd.toFixed(4)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="工具调用"
        icon={Wrench}
        description={
          usage?.tools
            ? `主客服本次运行的工具使用；今日已记账 ${usage.tools.daily.coverage.totalRuns} 轮。`
            : "主客服每轮回答用到的工具。"
        }
        action={
          usage?.tools ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={
                  usage.tools.process.coverage.ratio >= 0.9
                    ? "default"
                    : usage.tools.process.coverage.ratio >= 0.7
                      ? "secondary"
                      : "destructive"
                }
                className="tabular-nums"
              >
                知识库覆盖 {pct(usage.tools.process.coverage.ratio)}
              </Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {usage.tools.process.coverage.groundedRuns}/
                {usage.tools.process.coverage.totalRuns} 轮
              </span>
              <Badge variant="outline" className="tabular-nums">
                其中 kb_search{" "}
                {pct(
                  usage.tools.process.coverage.searchRuns /
                    Math.max(usage.tools.process.coverage.totalRuns, 1)
                )}
              </Badge>
            </div>
          ) : undefined
        }
      >
        {!usage?.tools ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24" />
            ))}
          </div>
        ) : usage.tools.process.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            本次运行还没有工具调用记录。
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>工具</TableHead>
                <TableHead className="text-right">出现轮次</TableHead>
                <TableHead className="text-right">调用次数</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  每轮均次
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.tools.process.rows.map((r) => (
                <TableRow key={r.tool}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {r.toolLabel}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.runs}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.calls}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {r.perRun.toFixed(1)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {s?.lastError && (
        <SectionCard
          className="shrink-0 border-destructive/50"
          title={
            <span className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-4" />
              最近错误
            </span>
          }
          description="服务启动或连接出错，修改配置后会自动重试。"
        >
          <pre className="max-h-24 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">
            {s.lastError}
          </pre>
        </SectionCard>
      )}

      {s?.bootedAt && (
        <footer className="flex shrink-0 items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" />
          启动于 <RelativeTime ts={s.bootedAt} />
        </footer>
      )}
    </PageShell>
  )
}
