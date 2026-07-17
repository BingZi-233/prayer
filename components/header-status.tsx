"use client";

import { cn } from "@/lib/utils";
import { useLive } from "@/components/live-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { PollingIndicator } from "@/components/polling-indicator";
import { ChannelStatusLights } from "@/components/channel-status-lights";

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
    <div className="ml-auto flex shrink-0 items-center gap-2 text-xs sm:gap-3">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            dot,
            state === "running" && "animate-pulse"
          )}
        />
        <span className="text-muted-foreground">
          {status ? (STATE_LABEL[state!] ?? state) : "…"}
        </span>
      </span>
      {status && (
        <ChannelStatusLights
          className="hidden sm:inline-flex"
          channels={status.channels}
          wsConnected={status.wsConnected}
          compact
        />
      )}
      <PollingIndicator />
      <ThemeToggle />
    </div>
  );
}
