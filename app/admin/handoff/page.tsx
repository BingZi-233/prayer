"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelativeTime } from "@/components/relative-time";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { DataState } from "@/components/admin/data-state";
import { usePolling } from "@/components/admin/use-polling";
import { useGroupNames, useMemberNames } from "@/lib/group-name";

interface Sess {
  key: string;
  sessionId: string | null;
  active: boolean;
  humanMode?: boolean;
  humanSince?: number | null;
  lastQuestion: string | null;
  updatedAt: number;
}

function hangLabel(since: number | null | undefined): string {
  if (!since) return "—";
  const min = Math.max(0, Math.round((Date.now() - since) / 60_000));
  if (min < 1) return "刚转人工";
  if (min < 60) return `${min} 分`;
  const h = Math.floor(min / 60);
  return `${h} 时 ${min % 60} 分`;
}

export default function HandoffQueuePage() {
  const { data, error, loading, refresh } = usePolling<Sess[]>("/api/sessions");
  const { name, label } = useGroupNames();
  const rows = useMemo(
    () =>
      (data ?? [])
        .filter((s) => s.humanMode)
        .sort((a, b) => (a.humanSince ?? a.updatedAt) - (b.humanSince ?? b.updatedAt)),
    [data],
  );
  const memberName = useMemberNames(rows.map((r) => r.key));
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function sessionLabel(key: string): string {
    const nick = memberName(key);
    const base = label(key);
    if (!nick) return base;
    // label 已是 "群名 · uid",换成昵称更易读
    const [gid] = key.split(":");
    const g = Number(gid);
    return Number.isNaN(g) ? base : `${name(g)} · ${nick}`;
  }

  async function resume(key: string) {
    setBusyKey(key);
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume_handoff", key }),
      }).then((x) => x.json());
      if (r.ok) {
        toast.success("已恢复自动答");
        await refresh();
      } else {
        toast.error(r.error || "恢复失败");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="人工队列"
        description={`当前 ${rows.length} 个会话在人工接待。处理完成后可恢复自动答。`}
      />

      <SectionCard title="待接待会话" icon={LifeBuoy}>
        <DataState
          loading={loading}
          error={error}
          empty={rows.length === 0}
          onRetry={refresh}
          emptyIcon={LifeBuoy}
          emptyTitle="队列为空"
          emptyDescription="用户请求转人工后会出现在此。也可在「会话」页筛选。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>会话</TableHead>
                <TableHead>问题摘要</TableHead>
                <TableHead>挂起时长</TableHead>
                <TableHead>转人工时间</TableHead>
                <TableHead className="w-44">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{sessionLabel(r.key)}</span>
                      <span className="text-muted-foreground font-mono text-xs">{r.key}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[360px]">
                    {r.lastQuestion ? (
                      <span className="line-clamp-2 text-sm">{r.lastQuestion}</span>
                    ) : (
                      <span className="text-muted-foreground text-sm italic">暂无摘要</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="destructive" className="tabular-nums">
                      {hangLabel(r.humanSince)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime ts={r.humanSince ?? r.updatedAt} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        <Link href={`/admin/sessions?key=${encodeURIComponent(r.key)}&human=1`}>
                          <MessagesSquare data-icon="inline-start" />
                          查看会话
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={busyKey === r.key}
                        onClick={() => void resume(r.key)}
                      >
                        {busyKey === r.key ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <LifeBuoy data-icon="inline-start" />
                        )}
                        恢复自动答
                      </Button>
                    </div>
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
