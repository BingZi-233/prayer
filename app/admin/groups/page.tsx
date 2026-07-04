"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Row { groupId: number; enabled: boolean; messageCount: number; lastTs: number; cursor: number; sedimentedCount: number; }

const fmtTs = (ts: number) => (ts ? new Date(ts).toLocaleString() : "—");

export default function GroupsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});

  async function load() {
    try {
      const r = await fetch("/api/groups/activity").then((x) => x.json());
      if (r.ok) setRows(r.data);
    } catch {
      /* 静默 */
    }
  }
  async function loadNames() {
    try {
      const r = await fetch("/api/onebot/groups").then((x) => x.json());
      if (r.ok) setNames(Object.fromEntries((r.data as { groupId: number; groupName: string }[]).map((g) => [g.groupId, g.groupName])));
    } catch {
      /* bot 断连 → 回退裸 id */
    }
  }
  useEffect(() => {
    load();
    loadNames();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const name = (gid: number) => names[gid] ?? String(gid);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">生效群</h1>
        <p className="text-muted-foreground text-sm">生效群与有活动的群的运行概览(每 3 秒刷新)。</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Users className="size-4" />群活动</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无群活动。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>群</TableHead>
                  <TableHead>生效</TableHead>
                  <TableHead className="text-right">消息量</TableHead>
                  <TableHead>最近活动</TableHead>
                  <TableHead>反思进度</TableHead>
                  <TableHead className="text-right">已沉淀</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.groupId}>
                    <TableCell className="font-medium">{name(r.groupId)}</TableCell>
                    <TableCell>
                      <Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "生效" : "未生效"}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.messageCount}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtTs(r.lastTs)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.cursor ? fmtTs(r.cursor) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sedimentedCount}</TableCell>
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
