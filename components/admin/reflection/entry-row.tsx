"use client"

import { useState } from "react"
import { Check, X, FileUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RelativeTime } from "@/components/relative-time"
import { ItemCard } from "@/components/admin/item-card"
import type { Entry, EntryDetail } from "./types"

// 单条条目行:列表只带预览截断(SQL 内截断),首次展开才拉单条详情拿全文
// (compactions 同款修法:摘要常驻 3 秒轮询,全文按需,避免响应到 MB 级)
export function EntryRow({
  e,
  acting,
  onAct,
  groupName,
}: {
  e: Entry
  acting: number | null
  onAct: (id: number, action: "approve" | "reject" | "promote") => void
  groupName: (id: number) => string
}) {
  const [detail, setDetail] = useState<EntryDetail | null>(null)
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const truncated = e.contentLen != null && e.contentLen > e.content.length
  const hasSource = Boolean(e.question || e.answer)
  const st = e.status ?? "approved"

  async function load() {
    if (detail || pending) return
    setPending(true)
    setErr(null)
    try {
      const r = await fetch(`/api/reflection/entries/${e.id}`).then((x) =>
        x.json()
      )
      if (r.ok) setDetail(r.data as EntryDetail)
      else setErr(r.error ?? "加载失败")
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "网络错误")
    } finally {
      setPending(false)
    }
  }

  return (
    <ItemCard
      meta={
        <>
          {e.groupId === 0 ? (
            <Badge variant="outline">已整理</Badge>
          ) : e.groupId != null ? (
            <Badge variant="secondary">{groupName(e.groupId)}</Badge>
          ) : null}
          {st === "rejected" ? (
            <Badge variant="destructive">已驳回</Badge>
          ) : st === "promoted" ? (
            <Badge variant="outline">已升格</Badge>
          ) : st === "pending" ? (
            <Badge variant="secondary">待审</Badge>
          ) : (
            <Badge variant="default">已入库</Badge>
          )}
          <RelativeTime ts={e.ts} />
          <span className="ml-auto flex gap-1">
            {st !== "approved" && st !== "promoted" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={acting === e.id}
                onClick={() => onAct(e.id, "approve")}
                title="恢复入库"
                aria-label="恢复入库"
              >
                <Check data-icon="inline-start" />
              </Button>
            )}
            {st !== "rejected" && st !== "promoted" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={acting === e.id}
                onClick={() => onAct(e.id, "reject")}
                title="驳回"
                aria-label="驳回"
              >
                <X data-icon="inline-start" />
              </Button>
            )}
            {st === "approved" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={acting === e.id}
                onClick={() => onAct(e.id, "promote")}
                title="升格为正式文档"
                aria-label="升格为正式文档"
              >
                <FileUp data-icon="inline-start" />
              </Button>
            )}
          </span>
        </>
      }
    >
      <p className="text-sm whitespace-pre-wrap">
        {e.content}
        {truncated ? "…" : ""}
      </p>
      {(hasSource || truncated) && (
        <details
          className="mt-2"
          onToggle={(ev) => {
            if (ev.currentTarget.open) void load()
          }}
        >
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {truncated && hasSource
              ? "全文与来源问答"
              : truncated
                ? "查看全文"
                : "来源问答"}
          </summary>
          <div className="mt-1.5 flex flex-col gap-1 border-l-2 pl-2 text-xs">
            {truncated && (
              <p className="whitespace-pre-wrap">
                {err ? `加载失败:${err}` : (detail?.content ?? "加载中…")}
              </p>
            )}
            {(e.question || e.answer) && (
              <>
                {(detail?.question ?? e.question) && (
                  <p className="whitespace-pre-wrap">
                    <span className="text-muted-foreground">问:</span>
                    {detail?.question ?? e.question}
                  </p>
                )}
                {(detail?.answer ?? e.answer) && (
                  <p className="whitespace-pre-wrap">
                    <span className="text-muted-foreground">答:</span>
                    {detail?.answer ?? e.answer}
                  </p>
                )}
              </>
            )}
          </div>
        </details>
      )}
    </ItemCard>
  )
}
