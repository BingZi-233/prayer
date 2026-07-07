"use client";

import Link from "next/link";
import { Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelativeTime } from "@/components/relative-time";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { DataState } from "@/components/admin/data-state";
import { usePolling } from "@/components/admin/use-polling";
import { useGroupNames } from "@/lib/group-name";

interface Row { id: number; sessionKey: string; summary: string; status: string; createdAt: number; }

export default function TicketsPage() {
  const { data, error, loading, refresh } = usePolling<Row[]>("/api/tickets");
  const { label } = useGroupNames();

  const rows = data ?? [];
  const open = rows.filter((r) => r.status === "open").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="工单" description={`转人工触发的工单,共 ${rows.length} 条,${open} 条待处理。`} />

      <SectionCard title="工单列表" icon={Ticket}>
        <DataState
          loading={loading}
          error={error}
          empty={rows.length === 0}
          onRetry={refresh}
          emptyIcon={Ticket}
          emptyTitle="暂无工单"
          emptyDescription="转人工触发时会在此生成工单。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>会话</TableHead>
                <TableHead>摘要</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.id}</TableCell>
                  <TableCell><span className="text-xs">{label(r.sessionKey)}</span></TableCell>
                  <TableCell className="max-w-[360px] truncate">{r.summary}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "open" ? "default" : "secondary"}>{r.status === "open" ? "待处理" : "已关闭"}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground"><RelativeTime ts={r.createdAt} /></TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      <Link href={`/admin/sessions?key=${encodeURIComponent(r.sessionKey)}`}>查看会话</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataState>
      </SectionCard>
    </div>
  );
}
