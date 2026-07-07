"use client";

import { Brain, Clock, Layers } from "lucide-react";
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
interface Entry { id: number; content: string; groupId: number | null; ts: number | null; }
interface Data { config: { scanMs: number; lookbackMs: number; settleMs: number; windowMax: number }; groups: GroupRow[]; entries: Entry[]; }

const min = (ms: number) => `${Math.round(ms / 60000)} 分`;

export default function ReflectionPage() {
  const { data: d, error, loading, refresh } = usePolling<Data>("/api/reflection");
  const { name } = useGroupNames();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="反思" description="被动反思:从人工回复中沉淀知识,回填知识库供 Agent 检索。" />

      <StatGrid>
        <StatCard icon={Clock} label="扫描周期" value={d ? min(d.config.scanMs) : "—"} loading={loading} />
        <StatCard icon={Clock} label="沉降延迟" value={d ? min(d.config.settleMs) : "—"} loading={loading} />
        <StatCard icon={Layers} label="回溯窗口" value={d ? min(d.config.lookbackMs) : "—"} loading={loading} />
        <StatCard icon={Layers} label="窗口上限" value={d ? d.config.windowMax : "—"} loading={loading} />
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
        icon={Brain}
        title={`沉淀知识${d ? ` (${d.entries.length})` : ""}`}
        description="反思写入 kb 的 human-reflection 条目,Agent 检索可命中。"
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
              {d?.entries.map((e) => (
                <div key={e.id} className="bg-muted/40 rounded-md border p-3">
                  <div className="text-muted-foreground mb-1.5 flex items-center gap-2 text-xs">
                    {e.groupId != null && <Badge variant="secondary">{name(e.groupId)}</Badge>}
                    <RelativeTime ts={e.ts} />
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{e.content}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DataState>
      </SectionCard>
    </div>
  );
}
