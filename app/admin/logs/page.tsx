"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ScrollText } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Log {
  ts: number;
  level: string;
  msg: string;
}

const LOG_COLOR: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-600 dark:text-amber-500",
  error: "text-destructive",
};

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);

  async function load() {
    try {
      const r = await fetch("/api/logs").then((x) => x.json());
      if (r.ok) setLogs(r.data);
    } catch {
      /* 轮询失败静默 */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">运行日志</h1>
        <p className="text-muted-foreground text-sm">进程内环形缓冲,最近 500 条(每 3 秒刷新,重启后清空)。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="size-4" />
            日志
          </CardTitle>
          <CardDescription>{logs.length} 条</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无日志。</p>
          ) : (
            <ScrollArea className="bg-muted/40 h-[520px] rounded-md">
              <div className="flex flex-col gap-0.5 p-3 font-mono text-xs">
                {logs.map((l, i) => (
                  <div key={i} className={cn("flex gap-2", LOG_COLOR[l.level])}>
                    <span className="text-muted-foreground shrink-0">{new Date(l.ts).toLocaleTimeString()}</span>
                    <span className="shrink-0 uppercase">[{l.level}]</span>
                    <span className="break-all whitespace-pre-wrap">{l.msg}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
