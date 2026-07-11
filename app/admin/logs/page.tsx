"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ScrollText, Copy, Pause, Play, SearchX } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { DataState, EmptyState } from "@/components/admin/data-state";
import { usePolling } from "@/components/admin/use-polling";

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

// 清洗 ANSI 转义序列(如 \x1b[36m [browser] \x1b[39m)
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, "");

export default function LogsPage() {
  const { data, error, loading, refresh } = usePolling<Log[]>("/api/logs");
  const logs = data ?? [];
  const [levels, setLevels] = useState<Set<string>>(new Set(["info", "warn", "error"]));
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const shown = logs
    .map((l) => ({ ...l, msg: stripAnsi(l.msg) }))
    .filter((l) => levels.has(l.level) && (!query.trim() || l.msg.toLowerCase().includes(query.toLowerCase())));

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [shown.length, paused]);

  function toggleLevel(lv: string) {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });
  }

  function copyAll() {
    const text = shown.map((l) => `${new Date(l.ts).toLocaleTimeString()} [${l.level}] ${l.msg}`).join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success(`已复制 ${shown.length} 条`),
      () => toast.error("复制失败"),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="运行日志"
        description="最近 500 条运行日志，重启后清空。"
      />

      <SectionCard
        icon={ScrollText}
        title="日志"
        description={`${shown.length} / ${logs.length} 条`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(["info", "warn", "error"] as const).map((lv) => (
              <Badge
                key={lv}
                variant={levels.has(lv) ? "default" : "outline"}
                className="cursor-pointer uppercase select-none"
                onClick={() => toggleLevel(lv)}
              >
                {lv}
              </Badge>
            ))}
            <Input
              placeholder="搜索日志…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 w-48 text-xs"
            />
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play /> : <Pause />}
              {paused ? "继续滚动" : "暂停滚动"}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copyAll}>
              <Copy /> 复制
            </Button>
          </div>
        }
      >
        <DataState
          loading={loading}
          error={error}
          empty={logs.length === 0}
          onRetry={refresh}
          emptyIcon={ScrollText}
          emptyTitle="暂无日志"
          emptyDescription="服务运行后会输出日志。"
          skeleton={<Skeleton className="h-[520px] w-full" />}
        >
          {shown.length === 0 ? (
            <EmptyState icon={SearchX} title="无匹配日志" description="调整级别过滤或搜索关键词。" />
          ) : (
            <ScrollArea className="bg-muted/40 h-[520px] rounded-md">
              <div className="flex flex-col gap-0.5 p-3 font-mono text-xs">
                {shown.map((l, i) => (
                  <div key={i} className={cn("flex gap-2", LOG_COLOR[l.level])}>
                    {/* 日志行需精确到秒,保留绝对时间;相对时间会把同分钟内的多条都显示为「刚刚」 */}
                    <span className="text-muted-foreground shrink-0">{new Date(l.ts).toLocaleTimeString()}</span>
                    <span className="shrink-0 uppercase">[{l.level}]</span>
                    <span className="break-all whitespace-pre-wrap">{l.msg}</span>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          )}
        </DataState>
      </SectionCard>
    </div>
  );
}
