"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ScrollText,
  Copy,
  Pause,
  Play,
  SearchX,
  Search,
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
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

// 三级严重度视觉:节点色 / 图标 / 文字色。灰阶为主,error 用主题 destructive(红),warn 补一味 amber。
const LEVEL_STYLE = {
  error: {
    icon: AlertCircle,
    dot: "bg-destructive text-destructive-foreground",
    ring: "ring-destructive/25",
    text: "text-destructive",
    badge: "destructive" as const,
  },
  warn: {
    icon: AlertTriangle,
    dot: "bg-amber-500 text-white",
    ring: "ring-amber-500/25",
    text: "text-amber-600 dark:text-amber-400",
    badge: "secondary" as const,
  },
  info: {
    icon: Info,
    dot: "bg-muted text-muted-foreground",
    ring: "ring-border",
    text: "text-muted-foreground",
    badge: "outline" as const,
  },
};
const levelStyle = (lv: string) => LEVEL_STYLE[lv as keyof typeof LEVEL_STYLE] ?? LEVEL_STYLE.info;

// 清洗 ANSI 转义序列
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
const stripAnsi = (s: string | undefined) => (s ?? "").replace(ANSI, "");

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

// 归一化类别:显式 category 优先,否则 error/warn 归 unknown,其余空
function catOf(l: Log): string {
  return String(l.category ?? (l.level === "error" || l.level === "warn" ? "unknown" : ""));
}

function rowKey(l: Log, i: number): string {
  return `${l.ts}-${l.fingerprint ?? l.code ?? i}`;
}

export default function LogsPage() {
  const { data, error, loading, refresh } = usePolling<Log[]>("/api/logs");
  const logs = data ?? [];
  const [levels, setLevels] = useState<Set<string>>(new Set(["info", "warn", "error"]));
  const [categories, setCategories] = useState<Set<string> | "all">("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  // 先做 level + 搜索过滤(不含类别),供类别计数与最终列表复用
  const base = useMemo(
    () =>
      logs
        .map((l) => ({ ...l, msg: stripAnsi(l.msg), raw: l.raw ? stripAnsi(l.raw) : l.raw }))
        .filter((l) => levels.has(l.level))
        .filter((l) => !query.trim() || searchBlob(l).includes(query.toLowerCase())),
    [logs, levels, query],
  );

  // 每类别在当前 level+搜索 下的条数,用于过滤 Badge 计数
  const catCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of base) {
      const c = catOf(l);
      if (!c) continue;
      m.set(c, (m.get(c) ?? 0) + (l.count ?? 1));
    }
    return m;
  }, [base]);

  const shown = base.filter((l) => {
    if (categories === "all") return true;
    const cat = catOf(l);
    if (!cat) return categories.has("__plain__");
    return categories.has(cat);
  });

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

  function toggleRow(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
            {(["info", "warn", "error"] as const).map((lv) => {
              const on = levels.has(lv);
              return (
                <Badge
                  key={lv}
                  variant={on ? levelStyle(lv).badge : "outline"}
                  className={cn("cursor-pointer uppercase select-none", !on && "opacity-45")}
                  onClick={() => toggleLevel(lv)}
                >
                  {lv}
                </Badge>
              );
            })}
            <InputGroup className="h-8 w-52">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索 scope / 群 / 文案…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
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
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <Badge
            variant={categories === "all" ? "default" : "outline"}
            className="cursor-pointer select-none"
            onClick={() => setCategories("all")}
          >
            全部
          </Badge>
          {catKeys.map((cat) => {
            const active = categories !== "all" && categories.has(cat);
            const n = catCount.get(cat) ?? 0;
            return (
              <Badge
                key={cat}
                variant={active ? "default" : "outline"}
                className={cn("cursor-pointer select-none", !active && n === 0 && "opacity-40")}
                onClick={() => toggleCategory(cat)}
              >
                {CATEGORY_LABEL[cat]}
                <span
                  className={cn(
                    "ml-1 rounded px-1 text-[0.625rem] tabular-nums",
                    active ? "bg-primary-foreground/20" : "bg-muted-foreground/15",
                  )}
                >
                  {n}
                </span>
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
            <ScrollArea className="bg-muted/20 h-[560px] rounded-lg border">
              <ol className="relative py-2 pr-4 pl-3">
                {shown.map((l, i) => {
                  const last = l.lastTs ?? l.ts;
                  const count = l.count ?? 1;
                  const cat = l.category;
                  const key = rowKey(l, i);
                  const open = expanded.has(key);
                  const s = levelStyle(l.level);
                  const Icon = s.icon;
                  const isLast = i === shown.length - 1;
                  const hasDetail = Boolean(
                    l.hint ||
                      l.sessionKey ||
                      l.code ||
                      count > 1 ||
                      (l.raw && l.raw !== l.msg && l.raw !== l.title) ||
                      (!l.title && !l.category && l.msg),
                  );
                  return (
                    <li key={key} className="group/row relative flex gap-3">
                      {/* 时间轴列:节点 + 连接线 */}
                      <div className="relative flex w-5 shrink-0 flex-col items-center">
                        <span
                          className={cn(
                            "z-10 mt-1 flex size-5 items-center justify-center rounded-full ring-4 ring-offset-0",
                            s.dot,
                            s.ring,
                          )}
                        >
                          <Icon className="size-3" />
                        </span>
                        {!isLast ? <span className="bg-border/70 w-px flex-1" /> : null}
                      </div>

                      {/* 内容列 */}
                      <div className={cn("min-w-0 flex-1", isLast ? "pb-1" : "pb-4")}>
                        <button
                          type="button"
                          onClick={() => hasDetail && toggleRow(key)}
                          className={cn(
                            "flex w-full items-center gap-2 text-left",
                            hasDetail ? "cursor-pointer" : "cursor-default",
                          )}
                        >
                          <span className={cn("text-xs font-semibold tracking-wide uppercase", s.text)}>
                            {l.level}
                          </span>
                          {cat ? (
                            <span className="text-muted-foreground border-border rounded border px-1.5 py-px text-[0.65rem]">
                              {CATEGORY_LABEL[cat] ?? cat}
                            </span>
                          ) : null}
                          {count > 1 ? (
                            <Badge variant="secondary" className="tabular-nums">
                              ×{count}
                            </Badge>
                          ) : null}
                          {l.retryable === false ? (
                            <span className="text-destructive text-[0.65rem] font-medium">不可重试</span>
                          ) : null}
                          <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                            {new Date(last).toLocaleTimeString()}
                          </span>
                          {hasDetail ? (
                            <ChevronDown
                              className={cn(
                                "text-muted-foreground size-3.5 shrink-0 transition-transform duration-150",
                                open && "rotate-180",
                              )}
                            />
                          ) : null}
                        </button>

                        <p
                          className={cn(
                            "mt-0.5 text-sm break-words",
                            l.level === "error" ? "text-foreground font-medium" : "text-foreground/90",
                            !open && "truncate",
                          )}
                        >
                          {displayTitle(l)}
                        </p>

                        {open && hasDetail ? (
                          <div className="mt-2.5 space-y-2">
                            {(() => {
                              const meta = [
                                l.scope ? (["scope", l.scope] as const) : null,
                                l.groupId != null ? (["群", String(l.groupId)] as const) : null,
                                l.sessionKey ? (["session", l.sessionKey] as const) : null,
                                l.code ? (["code", l.code] as const) : null,
                                count > 1 ? (["首次", new Date(l.ts).toLocaleTimeString()] as const) : null,
                              ].filter(Boolean) as ReadonlyArray<readonly [string, string]>;
                              if (meta.length === 0) return null;
                              return (
                                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                  {meta.map(([k, v], mi) => (
                                    <span key={k} className="flex items-center gap-1.5">
                                      {mi > 0 ? <span className="bg-border size-1 rounded-full" /> : null}
                                      <span className="opacity-55">{k}</span>
                                      <span className="text-foreground/75 tabular-nums">{v}</span>
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                            {l.hint ? (
                              <p
                                className={cn(
                                  "border-l-2 border-current pl-2.5 text-xs leading-relaxed",
                                  l.level === "info" ? "border-border" : s.text,
                                )}
                              >
                                <span className="text-foreground/80">{l.hint}</span>
                              </p>
                            ) : null}
                            {l.raw && l.raw !== l.msg && l.raw !== l.title ? (
                              <pre className="bg-muted/70 text-muted-foreground max-h-40 overflow-auto rounded-md p-2.5 text-[0.7rem] leading-relaxed break-all whitespace-pre-wrap">
                                {l.raw}
                              </pre>
                            ) : null}
                            {!l.title && !l.category && l.msg && l.msg !== displayTitle(l) ? (
                              <p className="text-xs break-all whitespace-pre-wrap">{l.msg}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div ref={bottomRef} />
            </ScrollArea>
          )}
        </DataState>
      </SectionCard>
    </PageShell>
  );
}
