"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ScrollText,
  Copy,
  Pause,
  Play,
  SearchX,
  Search,
  ChevronRight,
} from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { DataState, EmptyState } from "@/components/admin/data-state"
import { usePolling } from "@/components/admin/use-polling"

interface Log {
  ts: number
  level: string
  msg: string
  scope?: string
  channel?: string
  chatId?: string
  /** @deprecated 用 channel+chatId */
  groupId?: number
  sessionKey?: string
  raw?: string
}

function chatLabel(l: Log): string {
  if (l.channel && l.chatId) return `${l.channel}:${l.chatId}`
  if (l.groupId != null) return `qq:${l.groupId}`
  return ""
}

// 级别:Badge 变体 + 行左侧色条 + 标签文字色
const LEVEL_STYLE = {
  error: {
    badge: "destructive" as const,
    rail: "bg-destructive",
    text: "text-destructive",
  },
  warn: {
    badge: "secondary" as const,
    rail: "bg-primary",
    text: "text-primary",
  },
  info: {
    badge: "outline" as const,
    rail: "bg-border",
    text: "text-muted-foreground",
  },
}
const LEVEL_LABEL = {
  info: "信息",
  warn: "警告",
  error: "错误",
} as const
const levelStyle = (lv: string) =>
  LEVEL_STYLE[lv as keyof typeof LEVEL_STYLE] ?? LEVEL_STYLE.info

// 清洗 ANSI 转义序列
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g")
const stripAnsi = (s: string | undefined) => (s ?? "").replace(ANSI, "")

function searchBlob(l: Log): string {
  return [
    l.msg,
    l.raw,
    l.scope,
    l.sessionKey,
    chatLabel(l),
    l.channel,
    l.chatId,
    l.groupId != null ? String(l.groupId) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function formatExport(l: Log): string {
  const bits = [
    new Date(l.ts).toLocaleString(),
    l.level.toUpperCase(),
    l.msg,
    l.scope ? `scope=${l.scope}` : "",
    chatLabel(l) ? `会话=${chatLabel(l)}` : "",
    l.sessionKey ? `session=${l.sessionKey}` : "",
    l.raw && l.raw !== l.msg ? `原始: ${l.raw}` : "",
  ].filter(Boolean)
  return bits.join(" | ")
}

// 同一毫秒可能写入多条(不再去重),index 参与 key 保证唯一
function rowKey(l: Log, i: number): string {
  return `${l.ts}-${i}`
}

function hasExpandableDetail(l: Log): boolean {
  return Boolean(
    l.scope ||
      l.sessionKey ||
      chatLabel(l) ||
      (l.raw && l.raw !== l.msg)
  )
}

export default function LogsPage() {
  const { data, error, loading, refresh } = usePolling<Log[]>("/api/logs")
  // useMemo 固定引用:data 未变时 logs 不变,下游 useMemo 依赖才稳定
  const logs = useMemo(() => data ?? [], [data])
  const [levels, setLevels] = useState<Set<string>>(
    new Set(["info", "warn", "error"])
  )
  const [query, setQuery] = useState("")
  const [paused, setPaused] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const parentRef = useRef<HTMLDivElement>(null)

  // level + 搜索过滤;顺序即写入顺序(时间线),不做任何合并
  const shown = useMemo(
    () =>
      logs
        .map((l) => ({
          ...l,
          msg: stripAnsi(l.msg),
          raw: l.raw ? stripAnsi(l.raw) : l.raw,
        }))
        .filter((l) => levels.has(l.level))
        .filter((l) => !query.trim() || searchBlob(l).includes(query.toLowerCase())),
    [logs, levels, query]
  )

  // 虚拟滚动:仅渲染可视区行,变高(展开详情)由 measureElement 自动重测。
  // 日志全量渲染会卡,虚拟化后 DOM 只保留可视区 + overscan。
  // tanstack virtual 返回的函数无法被 React Compiler 安全 memo,属已知不兼容库,压掉警告
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 12,
    getItemKey: (i) => rowKey(shown[i], i),
  })

  // 追新:未暂停时滚到最新一条
  useEffect(() => {
    if (!paused && shown.length > 0) {
      virtualizer.scrollToIndex(shown.length - 1, { align: "end" })
    }
  }, [shown.length, paused, virtualizer])

  function toggleLevel(lv: string) {
    setLevels((prev) => {
      const next = new Set(prev)
      if (next.has(lv)) next.delete(lv)
      else next.add(lv)
      return next
    })
  }

  function toggleRow(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function copyAll() {
    const text = shown.map(formatExport).join("\n")
    navigator.clipboard.writeText(text).then(
      () => toast.success(`已复制 ${shown.length} 条`),
      () => toast.error("复制失败")
    )
  }

  return (
    <PageShell>
      <PageHeader
        title="运行日志"
        description="按时间线逐条输出运行日志。内存保留最近 2000 条，重启后清空。"
      />

      <SectionCard
        icon={ScrollText}
        title="日志"
        description={`${shown.length} / ${logs.length} 条`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(["info", "warn", "error"] as const).map((lv) => {
              const on = levels.has(lv)
              return (
                <Badge
                  key={lv}
                  variant={on ? levelStyle(lv).badge : "outline"}
                  className={cn(
                    "cursor-pointer select-none",
                    !on && "opacity-45"
                  )}
                  onClick={() => toggleLevel(lv)}
                >
                  {LEVEL_LABEL[lv]}
                </Badge>
              )
            })}
            <InputGroup className="h-8 w-full sm:w-52">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索 scope / 群 / 文案…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? (
                <Play data-icon="inline-start" />
              ) : (
                <Pause data-icon="inline-start" />
              )}
              {paused ? "继续滚动" : "暂停滚动"}
            </Button>
            <Button variant="ghost" size="sm" onClick={copyAll}>
              <Copy data-icon="inline-start" />
              复制
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
            <EmptyState
              icon={SearchX}
              title="无匹配日志"
              description="调整级别过滤或搜索关键词。"
            />
          ) : (
            <div
              ref={parentRef}
              className="bg-muted/30 h-[560px] overflow-y-auto rounded-lg border font-mono text-[0.8125rem] leading-relaxed"
            >
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                  width: "100%",
                }}
              >
                {virtualizer.getVirtualItems().map((vi) => {
                  const l = shown[vi.index]
                  const key = rowKey(l, vi.index)
                  const open = expanded.has(key)
                  const s = levelStyle(l.level)
                  const chat = chatLabel(l)
                  const expandable = hasExpandableDetail(l)

                  return (
                    <div
                      key={vi.key}
                      data-index={vi.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${vi.start}px)`,
                      }}
                      className={cn(
                        "group/row border-border/50 relative border-b",
                        open ? "bg-muted/40" : "hover:bg-muted/50"
                      )}
                    >
                      {/* 左侧严重度色条 */}
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-y-0 left-0 w-0.5",
                          s.rail,
                          l.level === "info" &&
                            "opacity-0 group-hover/row:opacity-100"
                        )}
                      />

                      <button
                        type="button"
                        disabled={!expandable}
                        onClick={() => expandable && toggleRow(key)}
                        className={cn(
                          "flex w-full items-start gap-3 py-2 pr-3 pl-3.5 text-left",
                          expandable ? "cursor-pointer" : "cursor-default"
                        )}
                      >
                        <time
                          dateTime={new Date(l.ts).toISOString()}
                          className="text-muted-foreground w-[4.5rem] shrink-0 pt-px tabular-nums"
                        >
                          {new Date(l.ts).toLocaleTimeString()}
                        </time>

                        <span
                          className={cn(
                            "w-12 shrink-0 pt-px text-[0.7rem] font-semibold tracking-wide uppercase",
                            s.text
                          )}
                        >
                          {LEVEL_LABEL[l.level as keyof typeof LEVEL_LABEL] ?? l.level}
                        </span>

                        <span
                          className={cn(
                            "min-w-0 flex-1 break-words",
                            l.level === "error"
                              ? "text-foreground font-medium"
                              : "text-foreground/90",
                            !open && "truncate"
                          )}
                        >
                          {l.msg}
                        </span>

                        {expandable ? (
                          <ChevronRight
                            className={cn(
                              "text-muted-foreground mt-0.5 size-3.5 shrink-0 opacity-0 transition-all group-hover/row:opacity-100",
                              open && "rotate-90 opacity-100"
                            )}
                          />
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                      </button>

                      {open && expandable ? (
                        <div className="border-border/60 flex flex-col gap-2 border-t border-dashed py-2.5 pr-3 pl-3.5 sm:pl-[8.25rem]">
                          {(() => {
                            const meta = [
                              l.scope ? (["scope", l.scope] as const) : null,
                              chat ? (["会话", chat] as const) : null,
                              l.sessionKey
                                ? (["session", l.sessionKey] as const)
                                : null,
                            ].filter(Boolean) as ReadonlyArray<
                              readonly [string, string]
                            >
                            if (meta.length === 0) return null
                            return (
                              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                {meta.map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="flex items-center gap-1.5"
                                  >
                                    <span className="opacity-55">{k}</span>
                                    <span className="text-foreground/80 tabular-nums">
                                      {v}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            )
                          })()}
                          {l.raw && l.raw !== l.msg ? (
                            <pre className="bg-muted/80 text-muted-foreground max-h-36 overflow-auto rounded-md p-2.5 text-[0.7rem] leading-relaxed break-all whitespace-pre-wrap">
                              {l.raw}
                            </pre>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </DataState>
      </SectionCard>
    </PageShell>
  )
}
