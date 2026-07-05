"use client";

import { cn } from "@/lib/utils";
import { useLive } from "@/components/live-provider";
import { ThemeToggle } from "@/components/theme-toggle";

const STATE_LABEL: Record<string, string> = {
  running: "运行中",
  stopped: "已停止",
  starting: "启动中",
  error: "错误",
};

export function HeaderStatus() {
  const { status } = useLive();
  const state = status?.state;
  const dot =
    state === "running"
      ? "bg-primary"
      : state === "error"
        ? "bg-destructive"
        : "bg-muted-foreground/50";
  return (
    <div className="ml-auto flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 rounded-full", dot, state === "running" && "animate-pulse")} />
        <span className="text-muted-foreground">{status ? (STATE_LABEL[state!] ?? state) : "…"}</span>
        {status && !status.wsConnected && <span className="text-muted-foreground">· WS 断开</span>}
      </span>
      <ThemeToggle />
    </div>
  );
}
