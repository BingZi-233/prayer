"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { useGroupNames } from "@/lib/group-name";
import { RelativeTime } from "@/components/relative-time";

interface Row { id: number; sessionKey: string; summary: string; status: string; createdAt: number; }

export default function TicketsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const { label } = useGroupNames();

  async function load() {
    try {
      const r = await fetch("/api/tickets").then((x) => x.json());
      if (r.ok) setRows(r.data);
    } catch {
      /* 静默 */
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const open = rows.filter((r) => r.status === "open").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">工单</h1>
        <p className="text-muted-foreground text-sm">转人工触发的工单,共 {rows.length} 条,{open} 条待处理(每 3 秒刷新)。</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Ticket className="size-4" />工单列表</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Ticket /></EmptyMedia>
                <EmptyTitle>暂无工单</EmptyTitle>
                <EmptyDescription>转人工触发时会在此生成工单。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
