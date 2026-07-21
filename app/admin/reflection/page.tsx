"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Brain, Clock, Layers, GitCompareArrows, Timer, Gauge, Wand2, Check, X, FileUp, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RelativeTime } from "@/components/relative-time";
import { PageShell } from "@/components/admin/page-shell";
import { PageHeader } from "@/components/admin/page-header";
import { MetricBadge, MetricBadgeRow } from "@/components/admin/stat";
import { SectionCard } from "@/components/admin/section-card";
import { ItemCard } from "@/components/admin/item-card";
import { DataState } from "@/components/admin/data-state";
import { usePolling } from "@/components/admin/use-polling";
import { useGroupNames } from "@/lib/group-name";

interface GroupRow { groupId: number; cursor: number; lagMs: number | null; bufferCount: number; sedimentedCount: number; }
interface Entry {
  id: number;
  content: string;
  groupId: number | null;
  ts: number | null;
  question: string | null;
  answer: string | null;
  status?: "pending" | "approved" | "rejected" | "promoted";
}
interface Compaction { id: number; ts: number; beforeCount: number; afterCount: number; before: string[]; after: string[]; }
interface Data {
  config: {
    scanMs: number;
    lookbackMs: number;
    settleMs: number;
    windowMax: number;
    compactMs: number;
    compactMinEntries: number;
    promoteMs: number;
    promoteMinEntries: number;
    promoteMaxPerRun: number;
  };
  groups: GroupRow[];
  entries: Entry[];
  compactions: Compaction[];
}

const min = (ms: number) => `${Math.round(ms / 60000)} 分`;
const hr = (ms: number) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(ms % 3600000 ? 1 : 0)} 时` : min(ms));

function diff(before: string[], after: string[]) {
  const a = new Set(after);
  const b = new Set(before);
  return {
    removed: before.filter((x) => !a.has(x)),
    added: after.filter((x) => !b.has(x)),
    keptCount: before.filter((x) => a.has(x)).length,
  };
}

export default function ReflectionPage() {
  const { data: d, error, loading, refresh } = usePolling<Data>("/api/reflection");
  const { name } = useGroupNames();
  const [busy, setBusy] = useState(false);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [acting, setActing] = useState<number | null>(null);
  const entryCount = d?.entries.length ?? 0;
  const approvedCount = d?.entries.filter((e) => (e.status ?? "approved") === "approved").length ?? 0;
  const willCompact = d ? approvedCount >= d.config.compactMinEntries : false;
  const willPromote = d ? approvedCount >= d.config.promoteMinEntries && d.config.promoteMs > 0 : false;

  async function compact() {
    setBusy(true);
    try {
      const r = await fetch("/api/reflection/compact", { method: "POST" }).then((x) => x.json());
      if (r.ok) {
        toast.success(r.data.ran ? `已整理:${r.data.before} → ${r.data.after} 条` : "整理完成:无变化(未达阈值或结果不变)");
      } else {
        toast.error(`整理失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`整理失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function autoPromote() {
    setPromoteBusy(true);
    try {
      const r = await fetch("/api/reflection/promote", { method: "POST" }).then((x) => x.json());
      if (r.ok) {
        toast.success(
          r.data.promoted > 0
            ? `自动升格:评审 ${r.data.considered} 条,升格 ${r.data.promoted} 条`
            : `升格评审完成:候选 ${r.data.considered} 条,无需升格`
        );
      } else {
        toast.error(`升格失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`升格失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await refresh();
      setPromoteBusy(false);
    }
  }

  async function act(id: number, action: "approve" | "reject" | "promote") {
    setActing(id);
    try {
      const r = await fetch("/api/reflection", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      }).then((x) => x.json());
      if (r.ok) {
        if (action === "promote") toast.success(`已升格为正式文档：${r.data.file}`);
        else toast.success(action === "approve" ? "已恢复入库" : "已驳回");
        await refresh();
      } else toast.error(r.error || "操作失败");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="反思"
        description="从人工答复中提炼知识，自动写入知识库。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button disabled={promoteBusy || !willPromote} onClick={() => void autoPromote()}>
              {promoteBusy ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              {promoteBusy ? "升格评审中…" : "立即升格评审"}
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button disabled={busy || !willCompact} variant="outline">
                  {busy ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
                  {busy ? "整理中…" : "立即整理"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>立即整理反思条目</DialogTitle>
                  <DialogDescription>
                    对当前 {entryCount} 条知识做一次近义去重合并（保留细节，不因基础文档已覆盖而删除）。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">取消</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button onClick={compact} disabled={busy}>确认整理</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <MetricBadgeRow>
        <MetricBadge icon={Clock} label="扫描周期" value={d ? min(d.config.scanMs) : "—"} loading={loading} />
        <MetricBadge icon={Clock} label="静置等待" value={d ? min(d.config.settleMs) : "—"} loading={loading} />
        <MetricBadge icon={Layers} label="回溯范围" value={d ? min(d.config.lookbackMs) : "—"} loading={loading} />
        <MetricBadge icon={Layers} label="窗口上限" value={d ? d.config.windowMax : "—"} loading={loading} />
        <MetricBadge icon={Timer} label="整理周期" value={d ? hr(d.config.compactMs) : "—"} loading={loading} />
        <MetricBadge
          icon={Gauge}
          label="可整理/门槛"
          loading={loading}
          value={d ? `${approvedCount}/${d.config.compactMinEntries}` : "—"}
          tone={willCompact ? "primary" : undefined}
        />
        <MetricBadge
          icon={Sparkles}
          label="升格周期"
          value={d ? (d.config.promoteMs > 0 ? hr(d.config.promoteMs) : "关") : "—"}
          loading={loading}
        />
        <MetricBadge
          icon={FileUp}
          label="待升格候选"
          loading={loading}
          value={d ? `${approvedCount}/${d.config.promoteMinEntries}` : "—"}
          tone={willPromote ? "primary" : undefined}
        />
      </MetricBadgeRow>

      <SectionCard title="每群反思进度" description="各生效群的扫描与入库进度。">
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
          <Table>
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
                  <TableCell className="font-medium">{name(g.groupId)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime ts={g.cursor} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.lagMs == null ? "未反思" : g.lagMs > 0 ? min(g.lagMs) : "0"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{g.bufferCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.sedimentedCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataState>
      </SectionCard>

      <SectionCard
        icon={GitCompareArrows}
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
            {d?.compactions.map((c) => {
              const { removed, added, keptCount } = diff(c.before, c.after);
              return (
                <details key={c.id} className="bg-muted/40 rounded-md border">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-3 text-sm">
                    <RelativeTime ts={c.ts} />
                    <Badge variant="secondary" className="tabular-nums">
                      {c.beforeCount} → {c.afterCount} 条
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      移除 {removed.length} · 新增 {added.length} · 保留 {keptCount}
                    </span>
                  </summary>
                  <div className="flex flex-col gap-3 border-t p-3">
                    {removed.length > 0 && (
                      <div>
                        <p className="text-destructive mb-1 text-xs font-medium">
                          移除 / 被合并 ({removed.length})
                        </p>
                        <div className="flex flex-col gap-1">
                          {removed.map((t, i) => (
                            <p
                              key={i}
                              className="border-destructive/40 border-l-2 pl-2 text-sm whitespace-pre-wrap"
                            >
                              {t}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    {added.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium">新增 / 合并结果 ({added.length})</p>
                        <div className="flex flex-col gap-1">
                          {added.map((t, i) => (
                            <p
                              key={i}
                              className="border-primary/40 border-l-2 pl-2 text-sm whitespace-pre-wrap"
                            >
                              {t}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    {removed.length === 0 && added.length === 0 && (
                      <p className="text-muted-foreground text-sm">无文本变化(全部保留)。</p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </DataState>
      </SectionCard>

      <SectionCard
        icon={Brain}
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
          <ScrollArea className="h-[400px] pr-3">
            <div className="flex flex-col gap-2">
              {d?.entries.map((e) => {
                const hasSource = Boolean(e.question || e.answer);
                const st = e.status ?? "approved";
                return (
                  <ItemCard
                    key={e.id}
                    meta={
                      <>
                        {e.groupId === 0 ? (
                          <Badge variant="outline">已整理</Badge>
                        ) : e.groupId != null ? (
                          <Badge variant="secondary">{name(e.groupId)}</Badge>
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
                              onClick={() => act(e.id, "approve")}
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
                              onClick={() => act(e.id, "reject")}
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
                              onClick={() => act(e.id, "promote")}
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
                    <p className="text-sm whitespace-pre-wrap">{e.content}</p>
                    {hasSource && (
                      <details className="mt-2">
                        <summary className="text-muted-foreground cursor-pointer text-xs">
                          来源问答
                        </summary>
                        <div className="mt-1.5 flex flex-col gap-1 border-l-2 pl-2 text-xs">
                          {e.question && (
                            <p className="whitespace-pre-wrap">
                              <span className="text-muted-foreground">问:</span>
                              {e.question}
                            </p>
                          )}
                          {e.answer && (
                            <p className="whitespace-pre-wrap">
                              <span className="text-muted-foreground">答:</span>
                              {e.answer}
                            </p>
                          )}
                        </div>
                      </details>
                    )}
                  </ItemCard>
                );
              })}
            </div>
          </ScrollArea>
        </DataState>
      </SectionCard>
    </PageShell>
  );
}
