"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RelativeTime } from "@/components/relative-time"
import type { Compaction, CompactionDetail } from "./types"

function diff(before: string[], after: string[]) {
  const a = new Set(after)
  const b = new Set(before)
  return {
    removed: before.filter((x) => !a.has(x)),
    added: after.filter((x) => !b.has(x)),
    keptCount: before.filter((x) => a.has(x)).length,
  }
}

// 单条整理记录:摘要常驻,before/after 全文首次展开才拉 /api/reflection/compactions/[id]。
// 全文是整批知识条目(MB 级),不能跟着列表一起进 3 秒轮询。
export function CompactionRow({ c }: { c: Compaction }) {
  const [detail, setDetail] = useState<CompactionDetail | null>(null)
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    if (detail || pending) return
    setPending(true)
    setErr(null)
    try {
      const r = await fetch(`/api/reflection/compactions/${c.id}`).then((x) =>
        x.json()
      )
      if (r.ok) setDetail(r.data as CompactionDetail)
      else setErr(r.error ?? "加载失败")
    } catch (e) {
      setErr(e instanceof Error ? e.message : "网络错误")
    } finally {
      setPending(false)
    }
  }

  const changes = detail ? diff(detail.before, detail.after) : null

  return (
    <details
      className="rounded-lg border border-border/70 bg-card/50 shadow-xs ring-1 ring-foreground/5"
      onToggle={(e) => {
        if (e.currentTarget.open) void load()
      }}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-3 text-sm">
        <RelativeTime ts={c.ts} />
        <Badge variant="secondary" className="tabular-nums">
          {c.beforeCount} → {c.afterCount} 条
        </Badge>
        {changes && (
          <span className="text-xs text-muted-foreground">
            移除 {changes.removed.length} · 新增 {changes.added.length} · 保留{" "}
            {changes.keptCount}
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-3 border-t p-3">
        {pending && <Skeleton className="h-16 w-full" />}
        {err && (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive">{err}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        )}
        {changes && (
          <>
            {changes.removed.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-destructive">
                  移除 / 被合并 ({changes.removed.length})
                </p>
                <div className="flex flex-col gap-1">
                  {changes.removed.map((t, i) => (
                    <p
                      key={i}
                      className="border-l-2 border-destructive/40 pl-2 text-sm whitespace-pre-wrap"
                    >
                      {t}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {changes.added.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium">
                  新增 / 合并结果 ({changes.added.length})
                </p>
                <div className="flex flex-col gap-1">
                  {changes.added.map((t, i) => (
                    <p
                      key={i}
                      className="border-l-2 border-primary/40 pl-2 text-sm whitespace-pre-wrap"
                    >
                      {t}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {changes.removed.length === 0 && changes.added.length === 0 && (
              <p className="text-sm text-muted-foreground">
                无文本变化(全部保留)。
              </p>
            )}
          </>
        )}
      </div>
    </details>
  )
}
