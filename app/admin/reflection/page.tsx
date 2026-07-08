"use client";

import { Brain, Clock, Layers, GitCompareArrows, Timer, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelativeTime } from "@/components/relative-time";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard, StatGrid } from "@/components/admin/stat";
import { SectionCard } from "@/components/admin/section-card";
import { DataState } from "@/components/admin/data-state";
import { usePolling } from "@/components/admin/use-polling";
import { useGroupNames } from "@/lib/group-name";

interface GroupRow { groupId: number; cursor: number; lagMs: number | null; bufferCount: number; sedimentedCount: number; }
interface Entry { id: number; content: string; groupId: number | null; ts: number | null; question: string | null; answer: string | null; }
interface Compaction { id: number; ts: number; beforeCount: number; afterCount: number; before: string[]; after: string[]; }
interface Data {
  config: { scanMs: number; lookbackMs: number; settleMs: number; windowMax: number; compactMs: number; compactMinEntries: number };
  groups: GroupRow[];
  entries: Entry[];
  compactions: Compaction[];
}

const min = (ms: number) => `${Math.round(ms / 60000)} 分`;
const hr = (ms: number) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(ms % 3600000 ? 1 : 0)} 时` : min(ms));

// before/after 集合比对(精确同文):保留=交集、移除=before 独有、新增/合并=after 独有。
// LLM 会改写文本,故为近似 —— 被合并改写的旧条目会落进「移除」,合并结果落进「新增」。
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
  const entryCount = d?.entries.length ?? 0;
  const willCompact = d ? entryCount >= d.config.compactMinEntries : false;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="反思" description="被动反思:从人工回复沉淀知识回填知识库,并定期整理合并。" />

      <StatGrid>
        <StatCard icon={Clock} label="扫描周期" value={d ? min(d.config.scanMs) : "—"} loading={loading} />
        <StatCard icon={Clock} label="沉降延迟" value={d ? min(d.config.settleMs) : "—"} loading={loading} />
        <StatCard icon={Layers} label="回溯窗口" value={d ? min(d.config.lookbackMs) : "—"} loading={loading} />
        <StatCard icon={Layers} label="窗口上限" value={d ? d.config.windowMax : "—"} loading={loading} />
        <StatCard icon={Timer} label="整理周期" value={d ? hr(d.config.compactMs) : "—"} loading={loading} />
        <StatCard
          icon={Gauge}
          label="整理触发阈值"
          value={
            d ? (
              <span className="flex flex-col">
                <span>{d.config.compactMinEntries} 条</span>
                <span className="text-muted-foreground text-xs font-normal">
                  当前 {entryCount} 条 · {willCompact ? "将触发整理" : "未达阈值"}
                </span>
              </span>
            ) : "—"
          }
          loading={loading}
        />
      </StatGrid>

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
        description="每次压缩整理的时间与前后条数;展开查看被移除/新增(合并结果)的条目。差异按文本精确比对,LLM 改写的条目会分别落入移除与新增,仅供参考。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.compactions.length === 0}
          onRetry={refresh}
          emptyIcon={GitCompareArrows}
          emptyTitle="暂无整理记录"
          emptyDescription={`沉淀条目达到阈值(${d?.config.compactMinEntries ?? "—"} 条)后会定期整理,并在此留档。`}
          skeleton={<Skeleton className="h-32 w-full" />}
        >
          <div className="flex flex-col gap-2">
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
        description="反思写入 kb 的 human-reflection 条目,Agent 检索可命中。「已整理」为压缩合并后的全局条目。"
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
                return (
                  <div key={e.id} className="bg-muted/40 rounded-md border p-3">
                    <div className="text-muted-foreground mb-1.5 flex items-center gap-2 text-xs">
                      {e.groupId === 0 ? (
                        <Badge variant="outline">已整理</Badge>
                      ) : e.groupId != null ? (
                        <Badge variant="secondary">{name(e.groupId)}</Badge>
                      ) : null}
                      <RelativeTime ts={e.ts} />
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
