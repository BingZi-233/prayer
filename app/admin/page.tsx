"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
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
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { cn } from "@/lib/utils";

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

/** 指标徽章:标签 + 数值,可标警示 / 主色 */
function MetricBadge({
  label,
  value,
  icon: Icon,
  warn,
  tone,
  loading,
}: {
  label: string;
  value: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  warn?: boolean;
  tone?: "primary";
  loading?: boolean;
}) {
  return (
    <Badge
      variant={warn ? "destructive" : tone === "primary" ? "default" : "secondary"}
      className={cn(
        "h-8 gap-1.5 px-2.5 text-xs font-normal",
        !warn && tone !== "primary" && "bg-muted text-foreground",
      )}
    >
      {Icon && <Icon className="size-3 opacity-70" />}
      <span className={cn(tone === "primary" || warn ? "opacity-80" : "text-muted-foreground")}>
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-3.5 w-6" />
      ) : (
        <span className="font-semibold tabular-nums">{value}</span>
      )}
    </Badge>
  );
}

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
  const hasAlerts =
    (ov?.humanSessions ?? 0) > 0 || (s != null && !s.wsConnected);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:gap-6">
      {/* ── 第 1 行:页头 ── */}
      <PageHeader
        className="shrink-0"
        title="运行状态"
        description="实时监控 Agent 运行、连接与业务结果。"
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
                <DialogTitle>确认重启 Agent?</DialogTitle>
                <DialogDescription>
                  重启会断开当前 WS 连接并重新装配 Agent,进行中的会话可能中断。
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

      {/* ── 第 2 行:待办(条件) ── */}
      {hasAlerts ? (
        <SectionCard
          className="border-destructive/50 shrink-0"
          title={
            <span className="text-destructive flex items-center gap-2">
              <LifeBuoy className="size-4" />
              有待处理事项
            </span>
          }
          description="真实待办:人工会话 / WS 断开。"
          contentClassName="flex flex-wrap gap-2"
        >
          {(ov?.humanSessions ?? 0) > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/sessions?human=1">人工会话 {ov!.humanSessions}</Link>
            </Button>
          )}
          {s && !s.wsConnected && <Badge variant="destructive">WS 未连接</Badge>}
        </SectionCard>
      ) : null}

      {/* ── 第 3 行:运行概况,徽章横排整行 ── */}
      <SectionCard
        className="shrink-0"
        title="运行概况"
        icon={Activity}
        description="运行态、连接与核心计数。"
        contentClassName="flex flex-wrap gap-2"
      >
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
        <MetricBadge icon={Brain} label="沉淀知识" loading={!ov} value={ov?.reflectionCount ?? "—"} />
        <MetricBadge
          icon={Target}
          label="自动解决率"
          loading={!ov}
          value={m?.autoResolutionRate != null ? pct(m.autoResolutionRate) : "—"}
        />
      </SectionCard>

      {/* ── 第 4 行:今日结果独占整行,指标徽章化 ── */}
      <SectionCard
        className="shrink-0"
        title="今日结果指标"
        icon={Target}
        description="0 点起:自动答 / 主动 / 转人工 / 错误。自动解决率 ≈ 自动答 ÷ (自动+主动+转人工+错误)。"
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
            <MetricBadge
              icon={TriangleAlert}
              label="错误兜底"
              value={m.error}
              warn={m.error > 0}
            />
            <MetricBadge icon={ShieldCheck} label="意图拦截" value={m.blocked} />
            <MetricBadge icon={Zap} label="主动沉默" value={m.proactiveSilent} />
            <MetricBadge
              icon={TriangleAlert}
              label="主动标不当"
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

      {/* ── 第 5 行:LLM 用量独占整行,吃满剩余高度 ── */}
      <SectionCard
        title="LLM 用量 / 缓存命中"
        icon={Gauge}
        description={
          usage?.daily
            ? `本次进程内存累计;今日持久化 $${usage.daily.costUsd.toFixed(4)}${usage.daily.budgetUsd > 0 ? ` / 预算 $${usage.daily.budgetUsd}` : ""}。`
            : "本次进程运行以来按调用点统计。重启后内存清零,日表仍保留。"
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
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {!usage ? (
          <div className="text-muted-foreground text-sm">加载中…</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-muted-foreground bg-card sticky top-0 z-10 text-xs">
                <tr className="border-b [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-right [&>th:first-child]:text-left">
                  <th className="bg-card sticky left-0 z-20">调用点</th>
                  <th>次数</th>
                  <th>命中率</th>
                  <th className="hidden sm:table-cell">命中/写入(tok)</th>
                  <th className="hidden md:table-cell">未缓存(tok)</th>
                  <th className="hidden md:table-cell">输出(tok)</th>
                  <th>成本($)</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map((r) => (
                  <tr
                    key={r.site}
                    className="border-b [&>td]:px-2 [&>td]:py-1.5 [&>td]:text-right [&>td:first-child]:text-left"
                  >
                    <td className="bg-card sticky left-0 z-10 font-medium whitespace-nowrap">
                      {r.label}
                    </td>
                    <td>{r.count}</td>
                    <td>
                      <Badge variant={r.hitRatio >= 0.8 ? "default" : "secondary"}>
                        {pct(r.hitRatio)}
                      </Badge>
                    </td>
                    <td className="hidden sm:table-cell">
                      {kfmt(r.cacheRead)} / {kfmt(r.cacheCreation)}
                    </td>
                    <td className="hidden md:table-cell">{kfmt(r.input)}</td>
                    <td className="hidden md:table-cell">{kfmt(r.output)}</td>
                    <td>{r.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
                <tr className="font-medium [&>td]:px-2 [&>td]:py-1.5 [&>td]:text-right [&>td:first-child]:text-left">
                  <td className="bg-card sticky left-0 z-10">合计</td>
                  <td>{usage.total.count}</td>
                  <td>
                    <Badge variant="secondary">{pct(usage.total.hitRatio)}</Badge>
                  </td>
                  <td className="hidden sm:table-cell">
                    {kfmt(usage.total.cacheRead)} / {kfmt(usage.total.cacheCreation)}
                  </td>
                  <td className="hidden md:table-cell">{kfmt(usage.total.input)}</td>
                  <td className="hidden md:table-cell">{kfmt(usage.total.output)}</td>
                  <td>{usage.total.costUsd.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── 第 6 行:错误(条件) ── */}
      {s?.lastError && (
        <SectionCard
          className="border-destructive/50 shrink-0"
          title={
            <span className="text-destructive flex items-center gap-2">
              <TriangleAlert className="size-4" />
              最近错误
            </span>
          }
          description="Agent 装配或连接出错,修改配置后将自动重试。"
        >
          <pre className="bg-muted text-muted-foreground max-h-24 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {s.lastError}
          </pre>
        </SectionCard>
      )}

      {/* ── 第 7 行:页脚 ── */}
      {s?.bootedAt && (
        <footer className="text-muted-foreground flex shrink-0 items-center gap-1.5 border-t pt-3 text-xs lg:pt-4">
          <Clock className="size-3.5 shrink-0" />
          启动于 <RelativeTime ts={s.bootedAt} />
        </footer>
      )}
    </div>
  );
}
