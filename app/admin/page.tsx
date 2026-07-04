"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Status {
  state: string;
  wsConnected: boolean;
  sessionCount: number;
  handoffQueue: number;
  lastError?: string;
  bootedAt?: number;
}

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/status").then((x) => x.json());
    if (r.ok) setS(r.data);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  async function restart() {
    setBusy(true);
    await fetch("/api/runtime/restart", { method: "POST" });
    await load();
    setBusy(false);
  }

  const stateColor = s?.state === "running" ? "default" : s?.state === "error" ? "destructive" : "secondary";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">运行状态</h1>
        <Button onClick={restart} disabled={busy}>{busy ? "重启中…" : "重启 Agent"}</Button>
      </div>
      {s && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">状态</div>
            <Badge variant={stateColor}>{s.state}</Badge>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">WS 连接</div>
            <Badge variant={s.wsConnected ? "default" : "secondary"}>{s.wsConnected ? "已连接" : "断开"}</Badge>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">会话数</div>
            <div className="text-2xl font-semibold">{s.sessionCount}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">转人工队列</div>
            <div className="text-2xl font-semibold">{s.handoffQueue}</div>
          </Card>
        </div>
      )}
      {s?.lastError && (
        <Card className="border-destructive p-4">
          <div className="text-sm font-medium text-destructive">最近错误</div>
          <pre className="mt-1 text-xs whitespace-pre-wrap">{s.lastError}</pre>
        </Card>
      )}
      {s?.bootedAt && (
        <div className="text-xs text-muted-foreground">启动于 {new Date(s.bootedAt).toLocaleString()}</div>
      )}
    </div>
  );
}
