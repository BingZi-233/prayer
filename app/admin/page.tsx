"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Activity, Plug, Users, RotateCw, TriangleAlert, Clock, LifeBuoy, ShieldCheck, Brain } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { RelativeTime } from "@/components/relative-time";

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

  const stats: { label: string; icon: typeof Activity; node?: React.ReactNode; value?: number }[] = [
    {
      label: "运行状态",
      icon: Activity,
      node: s ? <Badge variant={stateVariant(s.state)}>{STATE_LABEL[s.state] ?? s.state}</Badge> : null,
    },
    {
      label: "WS 连接",
      icon: Plug,
      node: s ? (
        <Badge variant={s.wsConnected ? "default" : "secondary"}>{s.wsConnected ? "已连接" : "断开"}</Badge>
      ) : null,
    },
    { label: "活动会话", icon: Users, value: s?.sessionCount },
    { label: "转人工/工单", icon: LifeBuoy, value: s?.handoffQueue },
    { label: "生效群", icon: ShieldCheck, value: ov?.enabledGroups },
    { label: "沉淀知识", icon: Brain, value: ov?.reflectionCount },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">运行状态</h1>
          <p className="text-muted-foreground text-sm">实时监控 Agent 运行、连接与会话情况(每 3 秒刷新)。</p>
        </div>
        <Button onClick={restart} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
          {busy ? "重启中…" : "重启 Agent"}
        </Button>
      </div>

      {(ov?.openTickets ?? 0) > 0 || (ov?.humanSessions ?? 0) > 0 ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2 text-base">
              <LifeBuoy className="size-4" />
              有待处理事项
            </CardTitle>
            <CardDescription>转人工客户正在等待,请尽快处理。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
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
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((st) => (
          <Card key={st.label}>
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <st.icon className="size-4" />
                {st.label}
              </CardDescription>
              <CardTitle className="text-2xl">
                {!s ? <Skeleton className="h-8 w-20" /> : st.node !== undefined ? st.node : st.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {s?.lastError && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2 text-base">
              <TriangleAlert className="size-4" />
              最近错误
            </CardTitle>
            <CardDescription>Agent 装配或连接出错,修改配置后将自动重试。</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted text-muted-foreground overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {s.lastError}
            </pre>
          </CardContent>
        </Card>
      )}

      {s?.bootedAt && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Clock className="size-3.5" />
          启动于 <RelativeTime ts={s.bootedAt} />
        </p>
      )}
    </div>
  );
}
