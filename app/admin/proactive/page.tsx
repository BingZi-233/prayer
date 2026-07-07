"use client";

import { useEffect, useState } from "react";
import { Zap, Clock, Timer, Hash, MessageSquareReply, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelativeTime } from "@/components/relative-time";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

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
  const [d, setD] = useState<Data | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});

  async function load() {
    try {
      const r = await fetch("/api/proactive").then((x) => x.json());
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
        <h1 className="text-2xl font-semibold tracking-tight">主动回复</h1>
        <p className="text-muted-foreground text-sm">无人应答兜底:生效群有人提问且久无人应答时 bot 主动补位(每 3 秒刷新)。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2"><Zap className="size-4" />状态</CardDescription>
            <CardTitle className="text-2xl">
              {!d ? "—" : d.config.enabled ? <span className="text-green-600 dark:text-green-500">已启用</span> : <span className="text-muted-foreground">已关闭</span>}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Timer className="size-4" />静默阈值</CardDescription><CardTitle className="text-2xl">{d ? min(d.config.silenceMs) : "—"}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Clock className="size-4" />扫描周期</CardDescription><CardTitle className="text-2xl">{d ? min(d.config.scanMs) : "—"}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader><CardDescription className="flex items-center gap-2"><Hash className="size-4" />单次上限</CardDescription><CardTitle className="text-2xl">{d ? d.config.maxPerScan : "—"}</CardTitle></CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">每群兜底进度</CardTitle></CardHeader>
        <CardContent>
          {!d || d.groups.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Zap /></EmptyMedia>
                <EmptyTitle>暂无生效群</EmptyTitle>
                <EmptyDescription>在配置页选择生效群并启用主动回复后,进度会在此显示。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
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
                {d.groups.map((g) => (
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><MessageSquareReply className="size-4" />最近主动回复 {d && `(${d.total})`}</CardTitle>
          <CardDescription>bot 主动补位发出的答复(问题原料 + 回答)。</CardDescription>
        </CardHeader>
        <CardContent>
          {!d || d.replies.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><MessageSquareReply /></EmptyMedia>
                <EmptyTitle>暂无主动回复</EmptyTitle>
                <EmptyDescription>bot 主动补位后,记录会在此展示。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea className="h-[400px] pr-3">
              <div className="flex flex-col gap-3">
                {d.replies.map((e) => (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
