"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelativeTime } from "@/components/relative-time";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { DataState } from "@/components/admin/data-state";
import { usePolling } from "@/components/admin/use-polling";
import { useGroupNames } from "@/lib/group-name";

interface Row {
  groupId: number;
  enabled: boolean;
  messageCount: number;
  lastTs: number;
  cursor: number;
  sedimentedCount: number;
}

export default function GroupsPage() {
  const { data, error, loading, refresh } = usePolling<Row[]>("/api/groups/activity");
  const { name } = useGroupNames();
  const [busyId, setBusyId] = useState<number | null>(null);

  const rows = data ?? [];

  async function toggle(groupId: number, enable: boolean) {
    setBusyId(groupId);
    try {
      // 读当前配置再改 enabledGroups
      const cur = await fetch("/api/config").then((x) => x.json());
      if (!cur.ok) {
        toast.error(cur.error || "读取配置失败");
        return;
      }
      const set = new Set<number>(cur.data.enabledGroups ?? []);
      if (enable) set.add(groupId);
      else set.delete(groupId);
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledGroups: Array.from(set) }),
      }).then((x) => x.json());
      if (r.ok) {
        toast.success(enable ? `已生效: ${name(groupId)}` : `已关闭: ${name(groupId)}`);
        // 首次开启时提示用法(管理可转发)
        if (enable) {
          toast.message("用法提示", {
            description: "群内问 bot 请 @机器人;重置发「重置」;转人工发「人工」。",
          });
        }
        await refresh();
      } else {
        toast.error(r.error || "保存失败");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="生效群" description="直接开关群是否由 bot 应答;也可在配置页批量选择。" />

      <SectionCard title="群活动" icon={Users}>
        <DataState
          loading={loading}
          error={error}
          empty={rows.length === 0}
          onRetry={refresh}
          emptyIcon={Users}
          emptyTitle="暂无群活动"
          emptyDescription="生效群产生消息后会在此展示。也可从配置页先勾选生效群。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
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
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={r.enabled}
                        disabled={busyId === r.groupId}
                        onCheckedChange={(v) => toggle(r.groupId, v)}
                      />
                      <Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "生效" : "未生效"}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.messageCount}</TableCell>
                  <TableCell className="text-muted-foreground"><RelativeTime ts={r.lastTs} /></TableCell>
                  <TableCell className="text-muted-foreground"><RelativeTime ts={r.cursor} /></TableCell>
                  <TableCell className="text-right tabular-nums">{r.sedimentedCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataState>
      </SectionCard>
    </div>
  );
}
