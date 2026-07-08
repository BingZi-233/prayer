"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Activity, Plug, Users, RotateCw, TriangleAlert, Clock, LifeBuoy, ShieldCheck, Brain, MessagesSquare, UserRound, ArrowUpRight, Gauge } from "lucide-react";
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
import { StatCard, StatGrid } from "@/components/admin/stat";
import { SectionCard } from "@/components/admin/section-card";
import { DataState } from "@/components/admin/data-state";
import { useGroupNames } from "@/lib/group-name";

interface Status {
  state: string;
  wsConnected: boolean;
  sessionCount: number;
  lastError?: string;
  bootedAt?: number;
  handoffQueue: number;
}
interface Sess { key: string; sessionId: string | null; humanMode: boolean; lastQuestion: string | null; updatedAt: number; }
interface Entry { id: number; content: string; groupId: number | null; ts: number | null; }
interface UsageRow { site: string; label: string; count: number; cacheRead: number; cacheCreation: number; input: number; output: number; costUsd: number; hitRatio: number; }
interface Usage { rows: UsageRow[]; total: UsageRow; }

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
  const [ov, setOv] = useState<{ enabledGroups: number; reflectionCount: number; openTickets: number; humanSessions: number } | null>(null);
  const [sessions, setSessions] = useState<Sess[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const { label, name } = useGroupNames();

  async function load() {
    try {
      const [st, o, se, rf, ug] = await Promise.all([
        fetch("/api/status").then((x) => x.json()),
        fetch("/api/overview").then((x) => x.json()),
        fetch("/api/sessions").then((x) => x.json()),
        fetch("/api/reflection").then((x) => x.json()),
        fetch("/api/usage").then((x) => x.json()),
      ]);
      if (st.ok) setS(st.data);
      if (o.ok) setOv(o.data);
      if (se.ok) setSessions(se.data);
      if (rf.ok) setEntries(rf.data.entries);
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

  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-0 flex-col gap-6">
      <PageHeader
        title="运行状态"
        description="实时监控 Agent 运行、连接与会话情况。"
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
                  重启会断开当前 WS 连接并重新装配 Agent,进行中的会话可能中断,运行日志将清空。
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

      {(ov?.openTickets ?? 0) > 0 || (ov?.humanSessions ?? 0) > 0 ? (
        <SectionCard
          className="border-destructive/50"
          title={
            <span className="text-destructive flex items-center gap-2">
              <LifeBuoy className="size-4" />
              有待处理事项
            </span>
          }
          description="转人工客户正在等待,请尽快处理。"
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
          icon={Gauge}
          label="缓存命中(本次运行)"
          loading={!usage}
          value={usage ? (usage.total.count > 0 ? pct(usage.total.hitRatio) : "—") : null}
        />
      </StatGrid>

      {usage && usage.rows.length > 0 && (
        <SectionCard
          title="LLM 用量 / 缓存命中"
          icon={Gauge}
          description="本次进程运行以来按调用点统计;缓存命中率 = 命中 /(命中+写入+未缓存)。重启清零。"
        >
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
        </SectionCard>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title="最近会话"
          icon={MessagesSquare}
          description="最新活跃的客户会话。"
          className="flex min-h-0 flex-col"
          contentClassName="min-h-0 flex-1 overflow-auto"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/sessions">
                查看全部 <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
          }
        >
          <DataState
            loading={sessions === null}
            empty={sessions?.length === 0}
            emptyIcon={MessagesSquare}
            emptyTitle="暂无会话"
            emptyDescription="生效群产生对话后会在此出现。"
            skeleton={<Skeleton className="h-40 w-full" />}
          >
            <div className="flex flex-col">
              {sessions?.slice(0, 30).map((sess) => (
                <Link
                  key={sess.key}
                  href={`/admin/sessions?key=${encodeURIComponent(sess.key)}`}
                  className="hover:bg-muted -mx-2 flex flex-col gap-0.5 rounded-md px-2 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {sess.humanMode && (
                        <Badge variant="destructive" className="gap-1">
                          <UserRound className="size-3" />人工
                        </Badge>
                      )}
                      <span className="truncate">{label(sess.key)}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      <RelativeTime ts={sess.updatedAt} />
                    </span>
                  </div>
                  {sess.lastQuestion && (
                    <span className="text-muted-foreground truncate text-xs">Q: {sess.lastQuestion}</span>
                  )}
                </Link>
              ))}
            </div>
          </DataState>
        </SectionCard>

        <SectionCard
          title="最近沉淀知识"
          icon={Brain}
          description="被动反思最新写入 kb 的问答要点。"
          className="flex min-h-0 flex-col"
          contentClassName="min-h-0 flex-1 overflow-auto"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/reflection">
                查看全部 <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
          }
        >
          <DataState
            loading={entries === null}
            empty={entries?.length === 0}
            emptyIcon={Brain}
            emptyTitle="暂无沉淀知识"
            emptyDescription="生效群有人工回复后会在此沉淀。"
            skeleton={<Skeleton className="h-40 w-full" />}
          >
            <div className="flex flex-col gap-3">
              {[...(entries ?? [])]
                .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
                .slice(0, 20)
                .map((e) => (
                  <div key={e.id} className="flex flex-col gap-1">
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      {e.groupId != null && <Badge variant="secondary">{name(e.groupId)}</Badge>}
                      <RelativeTime ts={e.ts} />
                    </div>
                    <p className="line-clamp-2 text-sm">{e.content}</p>
                  </div>
                ))}
            </div>
          </DataState>
        </SectionCard>
      </div>

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
