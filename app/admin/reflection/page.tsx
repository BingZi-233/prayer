"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Brain, Clock, Layers, GitCompareArrows, Timer, Gauge, Wand2, Check, X, FileUp } from "lucide-react";
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
import { PageHeader } from "@/components/admin/page-header";
import { MetricBadge, MetricBadgeRow } from "@/components/admin/stat";
import { SectionCard } from "@/components/admin/section-card";
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
  status?: "pending" | "approved" | "rejected";
}
interface Compaction { id: number; ts: number; beforeCount: number; afterCount: number; before: string[]; after: string[]; }
interface Data {
  config: { scanMs: number; lookbackMs: number; settleMs: number; windowMax: number; compactMs: number; compactMinEntries: number };
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
  const [acting, setActing] = useState<number | null>(null);
  const entryCount = d?.entries.length ?? 0;
  const willCompact = d ? entryCount >= d.config.compactMinEntries : false;

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

  async function act(id: number, action: "approve" | "reject" | "promote") {
    setActing(id);
    try {
      const r = await fetch("/api/reflection", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      }).then((x) => x.json());
      if (r.ok) {
        if (action === "promote") toast.success(`已升格到 docs/kb/${r.data.file}`);
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="反思"
        description="被动反思:从人工回复沉淀知识,自动入库。"
        actions={
          <Dialog>
            <DialogTrigger asChild>
              <Button disabled={busy || !willCompact}>
                {busy ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
                {busy ? "整理中…" : "立即整理"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>立即整理反思条目</DialogTitle>
                <DialogDescription>
                  对当前 {entryCount} 条沉淀条目做一次近义合并/去冗整理。
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
        }
      />

      <MetricBadgeRow>
        <MetricBadge icon={Clock} label="扫描周期" value={d ? min(d.config.scanMs) : "—"} loading={loading} />
        <MetricBadge icon={Clock} label="沉降延迟" value={d ? min(d.config.settleMs) : "—"} loading={loading} />
        <MetricBadge icon={Layers} label="回溯窗口" value={d ? min(d.config.lookbackMs) : "—"} loading={loading} />
        <MetricBadge icon={Layers} label="窗口上限" value={d ? d.config.windowMax : "—"} loading={loading} />
        <MetricBadge icon={Timer} label="整理周期" value={d ? hr(d.config.compactMs) : "—"} loading={loading} />
        <MetricBadge
          icon={Gauge}
          label="整理阈值"
          loading={loading}
          value={d ? `${entryCount}/${d.config.compactMinEntries}` : "—"}
          tone={willCompact ? "primary" : undefined}
        />
      </MetricBadgeRow>

      <SectionCard title="每群反思进度">
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.groups.length === 0}
          onRetry={refresh}
          emptyIcon={Brain}
          emptyTitle="暂无反思记录"
          emptyDescription="生效群有人工回复后会在此沉淀反思。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>群</TableHead>
                <TableHead>游标时间</TableHead>
                <TableHead className="text-right">滞后</TableHead>
                <TableHead className="text-right">缓冲消息</TableHead>
                <TableHead className="text-right">已沉淀</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d?.groups.map((g) => (
                <TableRow key={g.groupId}>
                  <TableCell className="font-medium">{name(g.groupId)}</TableCell>
                  <TableCell className="text-muted-foreground"><RelativeTime ts={g.cursor} /></TableCell>
                  <TableCell className="text-right tabular-nums">{g.lagMs == null ? "未反思" : g.lagMs > 0 ? min(g.lagMs) : "0"}</TableCell>
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
        description="每次压缩整理的时间与前后条数。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.compactions.length === 0}
          onRetry={refresh}
          emptyIcon={GitCompareArrows}
          emptyTitle="暂无整理记录"
          emptyDescription={`沉淀条目达到阈值(${d?.config.compactMinEntries ?? "—"} 条)后会定期整理。`}
          skeleton={<Skeleton className="h-32 w-full" />}
        >
          <div className="max-h-[calc(3*2.875rem+2*0.5rem)] space-y-2 overflow-y-auto pr-1">
            {d?.compactions.map((c) => {
              const { removed, added, keptCount } = diff(c.before, c.after);
              return (
                <details key={c.id} className="bg-muted/40 rounded-md border">
                  <summary className="flex cursor-pointer items-center gap-3 p-3 text-sm">
                    <RelativeTime ts={c.ts} />
                    <Badge variant="secondary" className="tabular-nums">{c.beforeCount} → {c.afterCount} 条</Badge>
                    <span className="text-muted-foreground text-xs">
                      移除 {removed.length} · 新增 {added.length} · 保留 {keptCount}
                    </span>
                  </summary>
                  <div className="flex flex-col gap-3 border-t p-3">
                    {removed.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">移除 / 被合并 ({removed.length})</p>
                        <div className="flex flex-col gap-1">
                          {removed.map((t, i) => (
                            <p key={i} className="border-l-2 border-red-400/60 pl-2 text-sm whitespace-pre-wrap">{t}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {added.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-green-600 dark:text-green-400">新增 / 合并结果 ({added.length})</p>
                        <div className="flex flex-col gap-1">
                          {added.map((t, i) => (
                            <p key={i} className="border-l-2 border-green-400/60 pl-2 text-sm whitespace-pre-wrap">{t}</p>
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
        title={`沉淀知识${d ? ` (${d.entries.length})` : ""}`}
        description="沉淀后自动入库;可驳回或升格写入 docs/kb/promoted/。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.entries.length === 0}
          onRetry={refresh}
          emptyIcon={Brain}
          emptyTitle="暂无沉淀知识"
          emptyDescription="反思写入 kb 的条目会在此展示。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <ScrollArea className="h-[400px] pr-3">
            <div className="flex flex-col gap-2">
              {d?.entries.map((e) => {
                const hasSource = Boolean(e.question || e.answer);
                const st = e.status ?? "approved";
                return (
                  <div key={e.id} className="bg-muted/40 rounded-md border p-3">
                    <div className="text-muted-foreground mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                      {e.groupId === 0 ? (
                        <Badge variant="outline">已整理</Badge>
                      ) : e.groupId != null ? (
                        <Badge variant="secondary">{name(e.groupId)}</Badge>
                      ) : null}
                      {st === "rejected" ? (
                        <Badge variant="destructive">已驳回</Badge>
                      ) : st === "pending" ? (
                        <Badge variant="secondary">待审</Badge>
                      ) : (
                        <Badge variant="default">已入库</Badge>
                      )}
                      <RelativeTime ts={e.ts} />
                      <span className="ml-auto flex gap-1">
                        {st !== "approved" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={acting === e.id} onClick={() => act(e.id, "approve")} title="恢复入库">
                            <Check className="size-3.5" />
                          </Button>
                        )}
                        {st !== "rejected" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={acting === e.id} onClick={() => act(e.id, "reject")} title="驳回">
                            <X className="size-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={acting === e.id} onClick={() => act(e.id, "promote")} title="升格正式文档">
                          <FileUp className="size-3.5" />
                        </Button>
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{e.content}</p>
                    {hasSource && (
                      <details className="mt-2">
                        <summary className="text-muted-foreground cursor-pointer text-xs">来源问答</summary>
                        <div className="mt-1.5 flex flex-col gap-1 border-l-2 pl-2 text-xs">
                          {e.question && <p className="whitespace-pre-wrap"><span className="text-muted-foreground">问:</span>{e.question}</p>}
                          {e.answer && <p className="whitespace-pre-wrap"><span className="text-muted-foreground">答:</span>{e.answer}</p>}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DataState>
      </SectionCard>
    </div>
  );
}
