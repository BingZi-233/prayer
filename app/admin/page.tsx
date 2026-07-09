"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Activity, Plug, Users, RotateCw, TriangleAlert, Clock, LifeBuoy, ShieldCheck, Brain, MessagesSquare, Gauge, Target, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
import { StatCard, StatGrid } from "@/components/admin/stat";
import { SectionCard } from "@/components/admin/section-card";

interface Status {
  state: string;
  wsConnected: boolean;
  sessionCount: number;
  lastError?: string;
  bootedAt?: number;
  handoffQueue: number;
}
interface UsageRow { site: string; label: string; count: number; cacheRead: number; cacheCreation: number; input: number; output: number; costUsd: number; hitRatio: number; }
interface Usage { rows: UsageRow[]; total: UsageRow; daily?: { day: string; costUsd: number; budgetUsd: number } | null; }
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
  openTickets: number;
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

function stateVariant(s?: string): "default" | "secondary" | "destructive" {
  if (s === "running") return "default";
  if (s === "error") return "destructive";
  return "secondary";
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
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="运行状态"
        description="实时监控 Agent 运行、连接与业务结果。"
        actions={
          <Dialog>
            <DialogTrigger asChild>
              <Button disabled={busy}>
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
                  <Button onClick={restart} disabled={busy}>确认重启</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {(ov?.openTickets ?? 0) > 0 || (ov?.humanSessions ?? 0) > 0 || (s && !s.wsConnected) ? (
        <SectionCard
          className="border-destructive/50"
          title={
            <span className="text-destructive flex items-center gap-2">
              <LifeBuoy className="size-4" />
              有待处理事项
            </span>
          }
          description="真实待办:工单 / 人工会话 / WS 断开。"
          contentClassName="flex flex-wrap gap-2"
        >
          {(ov?.openTickets ?? 0) > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/tickets">待处理工单 {ov!.openTickets}</Link>
            </Button>
          )}
          {(ov?.humanSessions ?? 0) > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/sessions?human=1">人工会话 {ov!.humanSessions}</Link>
            </Button>
          )}
          {s && !s.wsConnected && (
            <Badge variant="destructive">WS 未连接</Badge>
          )}
        </SectionCard>
      ) : null}

      <StatGrid className="lg:grid-cols-3">
        <StatCard
          icon={Activity}
          label="运行状态"
          loading={!s}
          value={s ? <Badge variant={stateVariant(s.state)}>{STATE_LABEL[s.state] ?? s.state}</Badge> : null}
        />
        <StatCard
          icon={Plug}
          label="WS 连接"
          loading={!s}
          value={s ? <Badge variant={s.wsConnected ? "default" : "secondary"}>{s.wsConnected ? "已连接" : "断开"}</Badge> : null}
        />
        <StatCard icon={Users} label="活动会话" loading={!s} value={s?.sessionCount} />
        <StatCard icon={ShieldCheck} label="生效群" loading={!s} value={ov?.enabledGroups} />
        <StatCard icon={Brain} label="沉淀知识" loading={!s} value={ov?.reflectionCount} />
        <StatCard
          icon={Target}
          label="今日自动解决率"
          loading={!ov}
          value={m?.autoResolutionRate != null ? pct(m.autoResolutionRate) : "—"}
        />
      </StatGrid>

      {m && (
        <SectionCard title="今日结果指标" icon={Target} description="0 点起:自动答 / 主动 / 转人工 / 错误。自动解决率 ≈ 自动答 ÷ (自动+主动+转人工+错误)。">
          <StatGrid className="lg:grid-cols-4">
            <StatCard icon={MessagesSquare} label="自动答" value={m.auto} />
            <StatCard icon={Zap} label="主动补位" value={m.proactive} />
            <StatCard icon={LifeBuoy} label="转人工" value={m.handoff} />
            <StatCard icon={TriangleAlert} label="错误兜底" value={m.error} />
            <StatCard icon={ShieldCheck} label="意图拦截" value={m.blocked} />
            <StatCard icon={Zap} label="主动沉默" value={m.proactiveSilent} />
            <StatCard icon={TriangleAlert} label="主动标不当" value={m.proactiveBad} />
            <StatCard
              icon={Gauge}
              label="今日成本"
              value={
                <span>
                  ${m.usageCostUsd.toFixed(4)}
                  {m.usageBudgetUsd > 0 && (
                    <span className="text-muted-foreground text-xs font-normal"> / ${m.usageBudgetUsd}</span>
                  )}
                </span>
              }
            />
          </StatGrid>
        </SectionCard>
      )}

      <SectionCard
        title="LLM 用量 / 缓存命中"
        icon={Gauge}
        description={
          usage?.daily
            ? `本次进程内存累计;今日持久化 $${usage.daily.costUsd.toFixed(4)}${usage.daily.budgetUsd > 0 ? ` / 预算 $${usage.daily.budgetUsd}` : ""}。`
            : "本次进程运行以来按调用点统计。重启后内存清零,日表仍保留。"
        }
      >
        {!usage ? (
          <div className="text-muted-foreground text-sm">加载中…</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr className="border-b [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-right [&>th:first-child]:text-left">
                  <th>调用点</th><th>次数</th><th>命中率</th><th>命中/写入(tok)</th><th>未缓存(tok)</th><th>输出(tok)</th><th>成本($)</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map((r) => (
                  <tr key={r.site} className="border-b [&>td]:px-2 [&>td]:py-1.5 [&>td]:text-right [&>td:first-child]:text-left">
                    <td className="font-medium">{r.label}</td>
                    <td>{r.count}</td>
                    <td><Badge variant={r.hitRatio >= 0.8 ? "default" : "secondary"}>{pct(r.hitRatio)}</Badge></td>
                    <td>{kfmt(r.cacheRead)} / {kfmt(r.cacheCreation)}</td>
                    <td>{kfmt(r.input)}</td>
                    <td>{kfmt(r.output)}</td>
                    <td>{r.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
                <tr className="[&>td]:px-2 [&>td]:py-1.5 [&>td]:text-right [&>td:first-child]:text-left font-medium">
                  <td>合计</td>
                  <td>{usage.total.count}</td>
                  <td>{pct(usage.total.hitRatio)}</td>
                  <td>{kfmt(usage.total.cacheRead)} / {kfmt(usage.total.cacheCreation)}</td>
                  <td>{kfmt(usage.total.input)}</td>
                  <td>{kfmt(usage.total.output)}</td>
                  <td>{usage.total.costUsd.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {s?.lastError && (
        <SectionCard
          className="border-destructive/50"
          title={
            <span className="text-destructive flex items-center gap-2">
              <TriangleAlert className="size-4" />
              最近错误
            </span>
          }
          description="Agent 装配或连接出错,修改配置后将自动重试。"
        >
          <pre className="bg-muted text-muted-foreground overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {s.lastError}
          </pre>
        </SectionCard>
      )}

      {s?.bootedAt && (
        <footer className="text-muted-foreground flex items-center gap-1.5 border-t pt-4 text-xs">
          <Clock className="size-3.5" />
          启动于 <RelativeTime ts={s.bootedAt} />
        </footer>
      )}
    </div>
  );
}
