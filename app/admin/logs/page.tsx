"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ScrollText, Copy, Pause, Play, SearchX } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/admin/page-shell";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { ItemCard } from "@/components/admin/item-card";
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

function levelVariant(level: string): "default" | "secondary" | "destructive" | "outline" {
  if (level === "error") return "destructive";
  if (level === "warn") return "secondary";
  return "outline";
}

// 清洗 ANSI 转义序列
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
const stripAnsi = (s: string) => s.replace(ANSI, "");

function displayTitle(l: Log): string {
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
    l.category ? (CATEGORY_LABEL[l.category] ?? l.category) : "",
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
    <PageShell>
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
                variant={levels.has(lv) ? levelVariant(lv) === "outline" ? "default" : levelVariant(lv) : "outline"}
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
              className="h-8 w-52"
            />
            <Button variant="ghost" size="sm" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
              {paused ? "继续滚动" : "暂停滚动"}
            </Button>
            <Button variant="ghost" size="sm" onClick={copyAll}>
              <Copy data-icon="inline-start" />
              复制
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
                variant={active ? "secondary" : "outline"}
                className="cursor-pointer select-none"
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
            <EmptyState
              icon={SearchX}
              title="无匹配日志"
              description="调整级别/类别过滤或搜索关键词。"
            />
          ) : (
            <ScrollArea className="bg-muted/40 h-[520px] rounded-md">
              <div className="flex flex-col gap-2 p-3">
                {shown.map((l, i) => {
                  const last = l.lastTs ?? l.ts;
                  const count = l.count ?? 1;
                  const cat = l.category;
                  return (
                    <ItemCard
                      key={`${l.ts}-${l.fingerprint ?? i}-${count}`}
                      className="bg-background/60"
                      meta={
                        <>
                          <span className="tabular-nums">
                            {new Date(last).toLocaleTimeString()}
                          </span>
                          <Badge variant={levelVariant(l.level)} className="uppercase">
                            {l.level}
                          </Badge>
                          {cat ? (
                            <Badge variant="outline">
                              {CATEGORY_LABEL[cat] ?? cat}
                            </Badge>
                          ) : null}
                          {count > 1 ? (
                            <Badge variant="secondary" className="tabular-nums">
                              ×{count}
                            </Badge>
                          ) : null}
                          {l.retryable === false ? (
                            <Badge variant="destructive">不可重试</Badge>
                          ) : null}
                        </>
                      }
                    >
                      <p className="text-sm font-medium break-all">{displayTitle(l)}</p>
                      <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
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
                        <p className="text-muted-foreground mt-1 text-xs leading-snug">
                          处置：{l.hint}
                        </p>
                      ) : null}
                      {l.raw && l.raw !== l.msg && l.raw !== l.title ? (
                        <details className="mt-1">
                          <summary className="text-muted-foreground cursor-pointer text-xs">
                            原始错误
                          </summary>
                          <pre className="bg-muted text-muted-foreground mt-1 max-h-32 overflow-auto rounded p-2 text-[10px] break-all whitespace-pre-wrap">
                            {l.raw}
                          </pre>
                        </details>
                      ) : null}
                      {!l.title && !l.hint && !l.category && l.msg ? (
                        <p className="mt-0.5 break-all whitespace-pre-wrap text-xs">{l.msg}</p>
                      ) : null}
                    </ItemCard>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          )}
        </DataState>
      </SectionCard>
    </PageShell>
  );
}
