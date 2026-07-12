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

type LogCategory =
  | "content_safety"
  | "rate_limit"
  | "auth"
  | "model"
  | "validation"
  | "infra"
  | "business"
  | "unknown";

interface Log {
  ts: number;
  lastTs?: number;
  level: string;
  msg: string;
  scope?: string;
  category?: LogCategory | string;
  code?: string;
  title?: string;
  hint?: string;
  retryable?: boolean;
  groupId?: number;
  sessionKey?: string;
  raw?: string;
  count?: number;
  fingerprint?: string;
}

const LEVEL_COLOR: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-600 dark:text-amber-500",
  error: "text-destructive",
};

const CATEGORY_LABEL: Record<string, string> = {
  content_safety: "内容安全",
  rate_limit: "限流",
  auth: "鉴权",
  model: "模型",
  validation: "校验",
  infra: "基础设施",
  business: "业务",
  unknown: "未分类",
};

const CATEGORY_TONE: Record<string, string> = {
  content_safety: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  rate_limit: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400",
  auth: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-400",
  model: "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-400",
  validation: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-400",
  infra: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  business: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400",
  unknown: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

// 清洗 ANSI 转义序列
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, "");

function displayTitle(l: Log): string {
  // 已分类用短标题;unknown / 无 code 用原文 msg
  if (l.code && l.code !== "unknown" && l.title) return l.title;
  return l.msg || l.title || "";
}

function searchBlob(l: Log): string {
  return [l.msg, l.title, l.hint, l.raw, l.scope, l.code, l.sessionKey, l.groupId != null ? String(l.groupId) : ""]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatExport(l: Log): string {
  const t = new Date(l.lastTs ?? l.ts).toLocaleString();
  const bits = [
    t,
    l.level.toUpperCase(),
    l.category ? CATEGORY_LABEL[l.category] ?? l.category : "",
    displayTitle(l),
    l.count && l.count > 1 ? `×${l.count}` : "",
    l.scope ? `scope=${l.scope}` : "",
    l.groupId != null ? `群=${l.groupId}` : "",
    l.code ? `code=${l.code}` : "",
    l.retryable === false ? "不可重试" : l.retryable === true ? "可重试" : "",
    l.hint ? `处置: ${l.hint}` : "",
    l.raw ? `原始: ${l.raw}` : "",
  ].filter(Boolean);
  return bits.join(" | ");
}

export default function LogsPage() {
  const { data, error, loading, refresh } = usePolling<Log[]>("/api/logs");
  const logs = data ?? [];
  const [levels, setLevels] = useState<Set<string>>(new Set(["info", "warn", "error"]));
  const [categories, setCategories] = useState<Set<string> | "all">("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const shown = logs
    .map((l) => ({ ...l, msg: stripAnsi(l.msg), raw: l.raw ? stripAnsi(l.raw) : l.raw }))
    .filter((l) => levels.has(l.level))
    .filter((l) => {
      if (categories === "all") return true;
      const cat = l.category ?? (l.level === "error" || l.level === "warn" ? "unknown" : "");
      if (!cat) return categories.has("__plain__");
      return categories.has(cat);
    })
    .filter((l) => !query.trim() || searchBlob(l).includes(query.toLowerCase()));

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [shown.length, paused, shown.map((l) => l.count).join(",")]);

  function toggleLevel(lv: string) {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });
  }

  function toggleCategory(cat: string) {
    setCategories((prev) => {
      if (prev === "all") return new Set([cat]);
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      if (next.size === 0) return "all";
      return next;
    });
  }

  function copyAll() {
    const text = shown.map(formatExport).join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success(`已复制 ${shown.length} 条`),
      () => toast.error("复制失败"),
    );
  }

  const catKeys = Object.keys(CATEGORY_LABEL);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="运行日志"
        description="结构化运行日志：自动分类、去重计数、处置建议。内存保留最近 500 条，重启后清空。"
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
              placeholder="搜索 scope / 群 / 文案…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 w-52 text-xs"
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
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Badge
            variant={categories === "all" ? "default" : "outline"}
            className="cursor-pointer select-none"
            onClick={() => setCategories("all")}
          >
            全部类别
          </Badge>
          {catKeys.map((cat) => {
            const active = categories !== "all" && categories.has(cat);
            return (
              <Badge
                key={cat}
                variant={active ? "default" : "outline"}
                className={cn("cursor-pointer select-none", active && CATEGORY_TONE[cat])}
                onClick={() => toggleCategory(cat)}
              >
                {CATEGORY_LABEL[cat]}
              </Badge>
            );
          })}
        </div>

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
            <EmptyState icon={SearchX} title="无匹配日志" description="调整级别/类别过滤或搜索关键词。" />
          ) : (
            <ScrollArea className="bg-muted/40 h-[520px] rounded-md">
              <div className="flex flex-col gap-1.5 p-3 font-mono text-xs">
                {shown.map((l, i) => {
                  const last = l.lastTs ?? l.ts;
                  const count = l.count ?? 1;
                  const cat = l.category;
                  return (
                    <div
                      key={`${l.ts}-${l.fingerprint ?? i}-${count}`}
                      className={cn(
                        "rounded-md border border-transparent px-2 py-1.5 hover:border-border/60 hover:bg-background/60",
                        LEVEL_COLOR[l.level],
                      )}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {new Date(last).toLocaleTimeString()}
                        </span>
                        <span className="shrink-0 uppercase opacity-80">[{l.level}]</span>
                        {cat ? (
                          <span
                            className={cn(
                              "rounded border px-1 py-px text-[10px] font-medium tracking-wide",
                              CATEGORY_TONE[cat] ?? CATEGORY_TONE.unknown,
                            )}
                          >
                            {CATEGORY_LABEL[cat] ?? cat}
                          </span>
                        ) : null}
                        {count > 1 ? (
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                            ×{count}
                          </Badge>
                        ) : null}
                        {l.retryable === false ? (
                          <span className="text-[10px] text-red-600/80 dark:text-red-400/80">不可重试</span>
                        ) : null}
                        <span className="min-w-0 flex-1 break-all font-sans text-[13px] font-medium text-foreground">
                          {displayTitle(l)}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-sans text-[11px]">
                        {l.scope ? <span>scope={l.scope}</span> : null}
                        {l.groupId != null ? <span>群={l.groupId}</span> : null}
                        {l.sessionKey ? <span>session={l.sessionKey}</span> : null}
                        {l.code ? <span className="opacity-80">{l.code}</span> : null}
                        {count > 1 ? (
                          <span className="opacity-70">
                            首次 {new Date(l.ts).toLocaleTimeString()}
                          </span>
                        ) : null}
                      </div>
                      {l.hint ? (
                        <p className="text-muted-foreground mt-1 font-sans text-[11px] leading-snug">
                          处置：{l.hint}
                        </p>
                      ) : null}
                      {l.raw && l.raw !== l.msg && l.raw !== l.title ? (
                        <details className="mt-1">
                          <summary className="text-muted-foreground cursor-pointer font-sans text-[11px]">
                            原始错误
                          </summary>
                          <pre className="text-muted-foreground mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/80 p-2 text-[10px]">
                            {l.raw}
                          </pre>
                        </details>
                      ) : null}
                      {/* 无结构化字段的旧式纯文本:仍显示 msg */}
                      {!l.title && !l.hint && !l.category && l.msg ? (
                        <p className="mt-0.5 break-all whitespace-pre-wrap">{l.msg}</p>
                      ) : null}
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          )}
        </DataState>
      </SectionCard>
    </div>
  );
}
