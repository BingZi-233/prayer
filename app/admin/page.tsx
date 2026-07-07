"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Activity, Plug, Users, RotateCw, TriangleAlert, Clock, LifeBuoy, ShieldCheck, Brain } from "lucide-react";
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

  async function load() {
    try {
      const [st, o] = await Promise.all([
        fetch("/api/status").then((x) => x.json()),
        fetch("/api/overview").then((x) => x.json()),
      ]);
      if (st.ok) setS(st.data);
      if (o.ok) setOv(o.data);
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
    <div className="flex flex-col gap-6">
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
        <StatCard icon={LifeBuoy} label="转人工/工单" loading={!s} value={s?.handoffQueue} />
        <StatCard icon={ShieldCheck} label="生效群" loading={!s} value={ov?.enabledGroups} />
        <StatCard icon={Brain} label="沉淀知识" loading={!s} value={ov?.reflectionCount} />
      </StatGrid>

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
