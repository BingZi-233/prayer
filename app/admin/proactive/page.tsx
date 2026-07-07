"use client";

import { Zap, Clock, Timer, Hash, MessageSquareReply, User } from "lucide-react";
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

interface GroupRow { groupId: number; enabled: boolean; cursor: number; lagMs: number | null; replyCount: number; lastReplyTs: number | null; }
interface Reply { id: number; groupId: number; userId: number; question: string; answer: string; ts: number; }
interface Data {
  config: { enabled: boolean; scanMs: number; silenceMs: number; maxPerScan: number };
  total: number;
  groups: GroupRow[];
  replies: Reply[];
}

const min = (ms: number) => `${Math.round(ms / 60000)} 分`;

export default function ProactivePage() {
  const { data: d, error, loading, refresh } = usePolling<Data>("/api/proactive");
  const { name } = useGroupNames();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="主动回复" description="无人应答兜底:生效群有人提问且久无人应答时 bot 主动补位。" />

      <StatGrid>
        <StatCard
          icon={Zap}
          label="状态"
          value={!d ? "—" : d.config.enabled ? <span className="text-green-600 dark:text-green-500">已启用</span> : <span className="text-muted-foreground">已关闭</span>}
          loading={loading}
        />
        <StatCard icon={Timer} label="静默阈值" value={d ? min(d.config.silenceMs) : "—"} loading={loading} />
        <StatCard icon={Clock} label="扫描周期" value={d ? min(d.config.scanMs) : "—"} loading={loading} />
        <StatCard icon={Hash} label="单次上限" value={d ? d.config.maxPerScan : "—"} loading={loading} />
      </StatGrid>

      <SectionCard title="每群兜底进度">
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.groups.length === 0}
          onRetry={refresh}
          emptyIcon={Zap}
          emptyTitle="暂无生效群"
          emptyDescription="在配置页选择生效群并启用主动回复后,进度会在此显示。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>群</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>游标时间</TableHead>
                <TableHead className="text-right">滞后</TableHead>
                <TableHead className="text-right">主动回复数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d?.groups.map((g) => (
                <TableRow key={g.groupId}>
                  <TableCell className="font-medium">{name(g.groupId)}</TableCell>
                  <TableCell>{g.enabled ? <Badge variant="secondary">生效</Badge> : <Badge variant="outline" className="text-muted-foreground">未生效</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{g.cursor === 0 ? "未扫描" : <RelativeTime ts={g.cursor} />}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.lagMs == null ? "未扫描" : g.lagMs > 0 ? min(g.lagMs) : "0"}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.replyCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataState>
      </SectionCard>

      <SectionCard
        icon={MessageSquareReply}
        title={`最近主动回复${d ? ` (${d.total})` : ""}`}
        description="bot 主动补位发出的答复(问题原料 + 回答)。"
      >
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.replies.length === 0}
          onRetry={refresh}
          emptyIcon={MessageSquareReply}
          emptyTitle="暂无主动回复"
          emptyDescription="bot 主动补位后,记录会在此展示。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <ScrollArea className="h-[400px] pr-3">
            <div className="flex flex-col gap-3">
              {d?.replies.map((e) => (
                <div key={e.id} className="bg-muted/40 rounded-md border p-3">
                  <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
                    <Badge variant="secondary">{name(e.groupId)}</Badge>
                    <span className="flex items-center gap-1"><User className="size-3" />{e.userId}</span>
                    <RelativeTime ts={e.ts} />
                  </div>
                  <p className="text-muted-foreground mb-1.5 line-clamp-2 text-xs whitespace-pre-wrap">问:{e.question}</p>
                  <p className="text-sm whitespace-pre-wrap">{e.answer}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DataState>
      </SectionCard>
    </div>
  );
}
