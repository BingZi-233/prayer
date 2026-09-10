"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Brain,
  GitCompareArrows,
  Wand2,
  Check,
  X,
  FileUp,
  Sparkles,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { VirtualList } from "@/components/admin/virtual-list"
import { Skeleton } from "@/components/ui/skeleton"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableShell } from "@/components/admin/table-shell"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { RelativeTime } from "@/components/relative-time"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { StatCard, StatGrid } from "@/components/admin/stat"
import { SectionCard } from "@/components/admin/section-card"
import { ItemCard } from "@/components/admin/item-card"
import { DataState } from "@/components/admin/data-state"
import { usePolling } from "@/components/admin/use-polling"
import { useGroupNames } from "@/lib/group-name"

interface GroupRow {
  groupId: number
  cursor: number
  lagMs: number | null
  bufferCount: number
  sedimentedCount: number
}
interface Entry {
  id: number
  content: string
  /** 全文长度;大于 content.length 说明列表给的是预览截断,全文按需拉详情 */
  contentLen?: number
  groupId: number | null
  ts: number | null
  question: string | null
  answer: string | null
  status?: "pending" | "approved" | "rejected" | "promoted"
}
// 单条条目全文(/api/reflection/entries/[id] 的响应),列表只带预览截断
interface EntryDetail {
  id: number
  content: string
  question: string | null
  answer: string | null
  status: "pending" | "approved" | "rejected" | "promoted"
}
// 列表只拿摘要:before/after 全文是整批知识条目,曾把 3 秒轮询的响应顶到 8MB+
interface Compaction {
  id: number
  ts: number
  beforeCount: number
  afterCount: number
}
interface CompactionDetail extends Compaction {
  before: string[]
  after: string[]
}
interface Data {
  config: {
    scanMs: number
    lookbackMs: number
    settleMs: number
    windowMax: number
    compactMs: number
    compactMinEntries: number
    promoteMs: number
    promoteMinEntries: number
    promoteMaxPerRun: number
  }
  groups: GroupRow[]
  entries: Entry[]
  compactions: Compaction[]
}

const min = (ms: number) => `${Math.round(ms / 60000)} 分`
const hr = (ms: number) =>
  ms >= 3600000 ? `${(ms / 3600000).toFixed(ms % 3600000 ? 1 : 0)} 时` : min(ms)

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
function CompactionRow({ c }: { c: Compaction }) {
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

// 知识条目虚拟列表:仅渲染可视区行,变高由 ResizeObserver 自动重测
// (展开"来源问答"会触发重测)。210+ 条时避免全量 DOM 导致滚动卡顿。
function EntryList({
  entries,
  acting,
  onAct,
  groupName,
}: {
  entries: Entry[]
  acting: number | null
  onAct: (id: number, action: "approve" | "reject" | "promote") => void
  groupName: (id: number) => string
}) {
  return (
    <VirtualList
      items={entries}
      getKey={(e) => e.id}
      gap={8}
      className="h-[400px] pr-3"
      renderItem={(e) => (
        <EntryRow e={e} acting={acting} onAct={onAct} groupName={groupName} />
      )}
    />
  )
}

// 单条条目行:列表只带预览截断(SQL 内截断),首次展开才拉单条详情拿全文
// (compactions 同款修法:摘要常驻 3 秒轮询,全文按需,避免响应到 MB 级)
function EntryRow({
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

export default function ReflectionPage() {
  const {
    data: d,
    error,
    loading,
    refresh,
  } = usePolling<Data>("/api/reflection")
  const { name } = useGroupNames()
  const [busy, setBusy] = useState(false)
  const [promoteBusy, setPromoteBusy] = useState(false)
  const [acting, setActing] = useState<number | null>(null)
  // 3s 轮询 + 操作都会触发 render:计数只随数据变化重算
  const { entryCount, approvedCount } = useMemo(() => {
    const es = d?.entries ?? []
    return {
      entryCount: es.length,
      approvedCount: es.filter((e) => (e.status ?? "approved") === "approved")
        .length,
    }
  }, [d])
  const willCompact = d ? approvedCount >= d.config.compactMinEntries : false
  const willPromote = d
    ? approvedCount >= d.config.promoteMinEntries && d.config.promoteMs > 0
    : false

  async function compact() {
    setBusy(true)
    try {
      const r = await fetch("/api/reflection/compact", { method: "POST" }).then(
        (x) => x.json()
      )
      if (r.ok) {
        toast.success(
          r.data.ran
            ? `已整理:${r.data.before} → ${r.data.after} 条`
            : "整理完成:无变化(未达阈值或结果不变)"
        )
      } else {
        toast.error(`整理失败:${r.error}`)
      }
    } catch (e) {
      toast.error(`整理失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await refresh({ force: true })
      setBusy(false)
    }
  }

  async function autoPromote() {
    setPromoteBusy(true)
    try {
      const r = await fetch("/api/reflection/promote", { method: "POST" }).then(
        (x) => x.json()
      )
      if (r.ok) {
        toast.success(
          r.data.promoted > 0
            ? `自动升格:评审 ${r.data.considered} 条,升格 ${r.data.promoted} 条`
            : `升格评审完成:候选 ${r.data.considered} 条,无需升格`
        )
      } else {
        toast.error(`升格失败:${r.error}`)
      }
    } catch (e) {
      toast.error(`升格失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await refresh({ force: true })
      setPromoteBusy(false)
    }
  }

  async function act(id: number, action: "approve" | "reject" | "promote") {
    setActing(id)
    try {
      const r = await fetch("/api/reflection", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      }).then((x) => x.json())
      if (r.ok) {
        if (action === "promote")
          toast.success(`已升格为正式文档：${r.data.file}`)
        else toast.success(action === "approve" ? "已恢复入库" : "已驳回")
        await refresh({ force: true })
      } else toast.error(r.error || "操作失败")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(null)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="反思"
        description="从人工答复中提炼知识，自动写入知识库。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={promoteBusy || !willPromote}
              onClick={() => void autoPromote()}
            >
              {promoteBusy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Sparkles data-icon="inline-start" />
              )}
              {promoteBusy ? "升格评审中…" : "立即升格评审"}
            </Button>
            <Dialog>
              <DialogTrigger
                render={
                  <Button disabled={busy || !willCompact} variant="outline" />
                }
              >
                {busy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Wand2 data-icon="inline-start" />
                )}
                {busy ? "整理中…" : "立即整理"}
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>立即整理反思条目</DialogTitle>
                  <DialogDescription>
                    对当前 {entryCount}{" "}
                    条知识做一次近义去重合并（保留细节，不因基础文档已覆盖而删除）。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    取消
                  </DialogClose>
                  <DialogClose
                    render={<Button onClick={compact} disabled={busy} />}
                  >
                    确认整理
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <StatGrid>
        <StatCard
          label="扫描周期"
          value={d ? min(d.config.scanMs) : "—"}
          hint="后台扫描生效会话的间隔。"
          loading={loading}
        />
        <StatCard
          label="静置等待"
          value={d ? min(d.config.settleMs) : "—"}
          hint="人工答复后静置多久才提炼,避免打断进行中的对话。"
          loading={loading}
        />
        <StatCard
          label="回溯范围"
          value={d ? min(d.config.lookbackMs) : "—"}
          hint="最多回看多久内的对话。"
          loading={loading}
        />
        <StatCard
          label="窗口上限"
          value={d ? d.config.windowMax : "—"}
          hint="单轮提炼的对话条数上限。"
          loading={loading}
        />
        <StatCard
          label="整理周期"
          value={d ? hr(d.config.compactMs) : "—"}
          hint="近义去重合并的自动执行周期。"
          loading={loading}
        />
        <StatCard
          label="可整理 / 门槛"
          loading={loading}
          value={d ? `${approvedCount}/${d.config.compactMinEntries}` : "—"}
          hint="已入库条目数与触发整理的门槛。"
        />
        <StatCard
          label="升格周期"
          value={
            d ? (d.config.promoteMs > 0 ? hr(d.config.promoteMs) : "关") : "—"
          }
          hint="正式文档升格评审的周期;「关」表示停用。"
          loading={loading}
        />
        <StatCard
          label="待升格候选"
          loading={loading}
          value={d ? `${approvedCount}/${d.config.promoteMinEntries}` : "—"}
          hint="已入库条目数与升格评审门槛。"
        />
      </StatGrid>

      <SectionCard
        title="每群反思进度"
        description="各生效群的扫描与入库进度。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.groups.length === 0}
          onRetry={refresh}
          emptyIcon={Brain}
          emptyTitle="暂无进度"
          emptyDescription="生效群出现人工答复后，进度会显示在这里。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <TableShell minWidth="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>群</TableHead>
                <TableHead>上次扫描</TableHead>
                <TableHead className="text-right">滞后</TableHead>
                <TableHead className="text-right">缓冲消息</TableHead>
                <TableHead className="text-right">已入库</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d?.groups.map((g) => (
                <TableRow key={g.groupId}>
                  <TableCell className="font-medium">
                    {name(g.groupId)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime ts={g.cursor} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.lagMs == null
                      ? "未反思"
                      : g.lagMs > 0
                        ? min(g.lagMs)
                        : "0"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.bufferCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.sedimentedCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableShell>
        </DataState>
      </SectionCard>

      <SectionCard
        title={`整理记录${d ? ` (${d.compactions.length})` : ""}`}
        description="每次整理的时间与条目变化。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.compactions.length === 0}
          onRetry={refresh}
          emptyIcon={GitCompareArrows}
          emptyTitle="暂无整理记录"
          emptyDescription={`已入库条目达到门槛（${d?.config.compactMinEntries ?? "—"} 条）后按整理周期自动分批去重；阈值不是目标条数。`}
          skeleton={<Skeleton className="h-32 w-full" />}
        >
          <div className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
            {d?.compactions.map((c) => (
              <CompactionRow key={c.id} c={c} />
            ))}
          </div>
        </DataState>
      </SectionCard>

      <SectionCard
        title={`知识条目${d ? ` (${d.entries.length})` : ""}`}
        description="自动入库的自学习知识，Agent 检索可直接命中；可驳回，或升格为正式文档。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.entries.length === 0}
          onRetry={refresh}
          emptyIcon={Brain}
          emptyTitle="暂无知识条目"
          emptyDescription="提炼出的知识会出现在这里。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          {d && (
            <EntryList
              entries={d.entries}
              acting={acting}
              onAct={act}
              groupName={name}
            />
          )}
        </DataState>
      </SectionCard>
    </PageShell>
  )
}
