"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Row { id: number; sessionKey: string; summary: string; status: string; createdAt: number; }

export default function TicketsPage() {
  const [rows, setRows] = useState<Row[]>([]);

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
            <p className="text-muted-foreground text-sm">暂无工单。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>会话</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">{r.id}</TableCell>
                    <TableCell>
                      <Link href="/admin/sessions" className="font-mono text-xs underline-offset-2 hover:underline">{r.sessionKey}</Link>
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate">{r.summary}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "open" ? "default" : "secondary"}>{r.status === "open" ? "待处理" : "已关闭"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
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
