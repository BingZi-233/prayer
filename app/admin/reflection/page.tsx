"use client";

import { useEffect, useState } from "react";
import { Brain, Clock, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GroupRow { groupId: number; cursor: number; lagMs: number | null; bufferCount: number; sedimentedCount: number; }
interface Entry { id: number; content: string; groupId: number | null; ts: number | null; }
interface Data { config: { scanMs: number; lookbackMs: number; settleMs: number; windowMax: number }; groups: GroupRow[]; entries: Entry[]; }

const min = (ms: number) => `${Math.round(ms / 60000)} 分`;
const fmtTs = (ts: number) => (ts ? new Date(ts).toLocaleString() : "—");

export default function ReflectionPage() {
  const [d, setD] = useState<Data | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});

  async function load() {
    try {
      const r = await fetch("/api/reflection").then((x) => x.json());
      if (r.ok) setD(r.data);
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
        <h1 className="text-2xl font-semibold tracking-tight">反思</h1>
        <p className="text-muted-foreground text-sm">被动反思:从人工回复中沉淀知识(每 3 秒刷新)。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Clock className="size-4" />扫描周期</CardDescription><CardTitle className="text-2xl">{d ? min(d.config.scanMs) : "—"}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Clock className="size-4" />沉降延迟</CardDescription><CardTitle className="text-2xl">{d ? min(d.config.settleMs) : "—"}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Layers className="size-4" />回溯窗口</CardDescription><CardTitle className="text-2xl">{d ? min(d.config.lookbackMs) : "—"}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Layers className="size-4" />窗口上限</CardDescription><CardTitle className="text-2xl">{d ? d.config.windowMax : "—"}</CardTitle></CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">每群反思进度</CardTitle></CardHeader>
        <CardContent>
          {!d || d.groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无群反思记录。</p>
          ) : (
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
                {d.groups.map((g) => (
                  <TableRow key={g.groupId}>
                    <TableCell className="font-medium">{name(g.groupId)}</TableCell>
                    <TableCell className="text-muted-foreground">{g.cursor ? fmtTs(g.cursor) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.lagMs == null ? "未反思" : g.lagMs > 0 ? min(g.lagMs) : "0"}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.bufferCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.sedimentedCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Brain className="size-4" />沉淀知识 {d && `(${d.entries.length})`}</CardTitle>
          <CardDescription>反思写入 kb 的 human-reflection 条目,Agent 检索可命中。</CardDescription>
        </CardHeader>
        <CardContent>
          {!d || d.entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无沉淀条目。</p>
          ) : (
            <ScrollArea className="h-[400px] pr-3">
              <div className="flex flex-col gap-2">
                {d.entries.map((e) => (
                  <div key={e.id} className="bg-muted/40 rounded-md border p-3">
                    <div className="text-muted-foreground mb-1.5 flex items-center gap-2 text-xs">
                      {e.groupId != null && <Badge variant="secondary">{name(e.groupId)}</Badge>}
                      <span>{e.ts ? fmtTs(e.ts) : "—"}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{e.content}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
