"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RelativeTime } from "@/components/relative-time";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageShell } from "@/components/admin/page-shell";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { MetricBadge, MetricBadgeRow } from "@/components/admin/stat";

interface Status {
  state: string;
  wsConnected: boolean;
  sessionCount: number;
  lastError?: string;
  bootedAt?: number;
  handoffQueue: number;
}
interface UsageRow {
  site: string;
  label: string;
  count: number;
  cacheRead: number;
  cacheCreation: number;
  input: number;
  output: number;
  costUsd: number;
  hitRatio: number;
}
interface Usage {
  rows: UsageRow[];
  total: UsageRow;
  daily?: { day: string; costUsd: number; budgetUsd: number } | null;
}
interface Metrics {
  auto: number;
  proactive: number;
  handoff: number;
  error: number;
  blocked: number;
  proactiveSilent: number;
  autoResolutionRate: number | null;
  proactiveBad: number;
  usageCostUsd: number;
  usageBudgetUsd: number;
}
interface Overview {
  enabledGroups: number;
  reflectionCount: number;
  humanSessions: number;
  metrics?: Metrics;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const STATE_LABEL: Record<string, string> = {
  running: "运行中",
  stopped: "已停止",
  starting: "启动中",
  error: "错误",
};

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [ov, setOv] = useState<Overview | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  async function load() {
    try {
      const [st, o, ug] = await Promise.all([
        fetch("/api/status").then((x) => x.json()),
        fetch("/api/overview").then((x) => x.json()),
        fetch("/api/usage").then((x) => x.json()),
      ]);
      if (st.ok) setS(st.data);
      if (o.ok) setOv(o.data);
      if (ug.ok) setUsage(ug.data);
    } catch {
      /* 轮询失败静默 */
    }
  }

  useEffect(() => {
    const boot = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 3000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(t);
    };
  }, []);

  async function restart() {
    setBusy(true);
    try {
      const r = await fetch("/api/runtime/restart", { method: "POST" }).then((x) => x.json());
      if (r.ok) {
        setS(r.data);
        toast.success("Agent 已重启");
      } else {
        toast.error(`重启失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`重启失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await load();
      setBusy(false);
    }
  }

  const m = ov?.metrics;
  const hasAlerts = (ov?.humanSessions ?? 0) > 0 || (s != null && !s.wsConnected);

  return (
    <PageShell fill className="lg:gap-6">
      <PageHeader
        className="shrink-0"
        title="运行状态"
        description="查看运行状态、连接与今日业务结果。"
        actions={
          <Dialog>
            <DialogTrigger asChild>
              <Button disabled={busy} className="w-full sm:w-auto">
                {busy ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
                {busy ? "重启中…" : "重启 Agent"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>确认重启 Agent？</DialogTitle>
                <DialogDescription>
                  重启会断开当前连接并重新加载服务，进行中的会话可能中断。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">取消</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button onClick={restart} disabled={busy}>
                    确认重启
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {hasAlerts ? (
        <SectionCard
          className="border-destructive/50 shrink-0"
          title={
            <span className="text-destructive flex items-center gap-2">
              <LifeBuoy className="size-4" />
              有待处理事项
            </span>
          }
          description="请尽快处理人工会话，或检查连接状态。"
          contentClassName="flex flex-wrap gap-2"
        >
          {(ov?.humanSessions ?? 0) > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/handoff">人工会话 {ov!.humanSessions}</Link>
            </Button>
          )}
          {s && !s.wsConnected && <Badge variant="destructive">WS 未连接</Badge>}
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
          label="WS"
          loading={!s}
          value={s ? (s.wsConnected ? "已连接" : "断开") : "—"}
          warn={!!s && !s.wsConnected}
          tone={s?.wsConnected ? "primary" : undefined}
        />
        <MetricBadge icon={Users} label="活动会话" loading={!s} value={s?.sessionCount ?? "—"} />
        <MetricBadge icon={ShieldCheck} label="生效群" loading={!ov} value={ov?.enabledGroups ?? "—"} />
        <MetricBadge icon={Brain} label="知识条目" loading={!ov} value={ov?.reflectionCount ?? "—"} />
        <MetricBadge
          icon={Target}
          label="自动解决率"
          loading={!ov}
          value={m?.autoResolutionRate != null ? pct(m.autoResolutionRate) : "—"}
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
            <MetricBadge icon={LifeBuoy} label="转人工" value={m.handoff} warn={m.handoff > 0} />
            <MetricBadge icon={TriangleAlert} label="错误" value={m.error} warn={m.error > 0} />
            <MetricBadge icon={ShieldCheck} label="意图拦截" value={m.blocked} />
            <MetricBadge icon={Zap} label="主动跳过" value={m.proactiveSilent} />
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
                    <span className="text-muted-foreground font-normal"> / ${m.usageBudgetUsd}</span>
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
            ? `本次运行累计；今日已记账 $${usage.daily.costUsd.toFixed(4)}${usage.daily.budgetUsd > 0 ? ` / 预算 $${usage.daily.budgetUsd}` : ""}。`
            : "按调用点统计本次运行用量。重启后内存计数清零，日汇总仍保留。"
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
        className="flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden"
        contentClassName="flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden"
      >
        {!usage ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24" />
            ))}
          </div>
        ) : (
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto lg:overscroll-contain">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>调用点</TableHead>
                  <TableHead className="text-right">次数</TableHead>
                  <TableHead className="text-right">命中率</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">缓存命中/写入</TableHead>
                  <TableHead className="hidden text-right md:table-cell">未缓存输入</TableHead>
                  <TableHead className="hidden text-right md:table-cell">输出</TableHead>
                  <TableHead className="text-right">成本($)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.rows.map((r) => (
                  <TableRow key={r.site}>
                    <TableCell className="font-medium whitespace-nowrap">{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={r.hitRatio >= 0.8 ? "default" : "secondary"}>
                        {pct(r.hitRatio)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {kfmt(r.cacheRead)} / {kfmt(r.cacheCreation)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {kfmt(r.input)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {kfmt(r.output)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.costUsd.toFixed(4)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell>合计</TableCell>
                  <TableCell className="text-right tabular-nums">{usage.total.count}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{pct(usage.total.hitRatio)}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {kfmt(usage.total.cacheRead)} / {kfmt(usage.total.cacheCreation)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {kfmt(usage.total.input)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {kfmt(usage.total.output)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {usage.total.costUsd.toFixed(4)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {s?.lastError && (
        <SectionCard
          className="border-destructive/50 shrink-0"
          title={
            <span className="text-destructive flex items-center gap-2">
              <TriangleAlert className="size-4" />
              最近错误
            </span>
          }
          description="服务启动或连接出错，修改配置后会自动重试。"
        >
          <pre className="bg-muted text-muted-foreground max-h-24 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {s.lastError}
          </pre>
        </SectionCard>
      )}

      {s?.bootedAt && (
        <footer className="text-muted-foreground flex shrink-0 items-center gap-1.5 border-t pt-3 text-xs">
          <Clock className="size-3.5 shrink-0" />
          启动于 <RelativeTime ts={s.bootedAt} />
        </footer>
      )}
    </PageShell>
  );
}
