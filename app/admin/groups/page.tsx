"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Users, Settings2, RotateCcw, Bell, Timer, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelativeTime } from "@/components/relative-time";
import { PageShell } from "@/components/admin/page-shell";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { MetricBadge, MetricBadgeRow } from "@/components/admin/stat";
import { DataState } from "@/components/admin/data-state";
import { usePolling } from "@/components/admin/use-polling";
import { useGroupNames } from "@/lib/group-name";

type Tri = "inherit" | "on" | "off";

interface GroupPolicy {
  proactiveEnabled?: boolean;
  proactiveSilenceMs?: number;
  notifyAdminOnHandoff?: boolean;
}

interface Row {
  groupId: number;
  enabled: boolean;
  messageCount: number;
  lastTs: number;
  cursor: number;
  sedimentedCount: number;
  policy: GroupPolicy;
  hasOverride: boolean;
  effective: {
    proactiveEnabled: boolean;
    proactiveSilenceMs: number;
    notifyAdminOnHandoff: boolean;
  };
}

interface Globals {
  proactiveEnabled: boolean;
  proactiveSilenceMs: number;
  notifyAdminOnHandoff: true;
}

interface ActivityData {
  groups: Row[];
  globals: Globals;
}

const min = (ms: number) => `${Math.round(ms / 60_000)} 分`;

function triFrom(v: boolean | undefined): Tri {
  if (v === undefined) return "inherit";
  return v ? "on" : "off";
}

function triToBool(t: Tri): boolean | undefined {
  if (t === "inherit") return undefined;
  return t === "on";
}

export default function GroupsPage() {
  const { data, error, loading, refresh } = usePolling<ActivityData>("/api/groups/activity");
  const { name } = useGroupNames();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // 编辑表单状态
  const [proactiveTri, setProactiveTri] = useState<Tri>("inherit");
  const [silenceMode, setSilenceMode] = useState<"inherit" | "custom">("inherit");
  const [silenceMin, setSilenceMin] = useState("3");
  const [handoffTri, setHandoffTri] = useState<Tri>("inherit");

  const rows = data?.groups ?? [];
  const globals = data?.globals;

  const overrideCount = useMemo(() => rows.filter((r) => r.hasOverride).length, [rows]);

  function openEditor(r: Row) {
    setEditing(r);
    setProactiveTri(triFrom(r.policy.proactiveEnabled));
    if (r.policy.proactiveSilenceMs !== undefined) {
      setSilenceMode("custom");
      setSilenceMin(String(Math.round(r.policy.proactiveSilenceMs / 60_000)));
    } else {
      setSilenceMode("inherit");
      setSilenceMin(String(Math.round((globals?.proactiveSilenceMs ?? 180_000) / 60_000)));
    }
    setHandoffTri(triFrom(r.policy.notifyAdminOnHandoff));
  }

  async function toggle(groupId: number, enable: boolean) {
    setBusyId(groupId);
    try {
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

  async function savePolicy() {
    if (!editing) return;
    setSavingPolicy(true);
    try {
      const policy: GroupPolicy = {};
      const pe = triToBool(proactiveTri);
      if (pe !== undefined) policy.proactiveEnabled = pe;
      if (silenceMode === "custom") {
        const m = Number(silenceMin);
        if (!Number.isFinite(m) || m < 0) {
          toast.error("静默阈值须为非负数字(分钟)");
          return;
        }
        policy.proactiveSilenceMs = Math.round(m * 60_000);
      }
      const nh = triToBool(handoffTri);
      if (nh !== undefined) policy.notifyAdminOnHandoff = nh;

      // 无任何覆盖 → 传 null 清除
      const payload =
        Object.keys(policy).length === 0
          ? { groupPolicies: { [String(editing.groupId)]: null } }
          : { groupPolicies: { [String(editing.groupId)]: policy } };

      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then((x) => x.json());
      if (r.ok) {
        toast.success(`已保存 ${name(editing.groupId)} 的策略`);
        setEditing(null);
        await refresh();
      } else {
        toast.error(r.error || "保存失败");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPolicy(false);
    }
  }

  async function clearPolicy(groupId: number) {
    setBusyId(groupId);
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupPolicies: { [String(groupId)]: null } }),
      }).then((x) => x.json());
      if (r.ok) {
        toast.success(`已恢复跟随全局: ${name(groupId)}`);
        if (editing?.groupId === groupId) setEditing(null);
        await refresh();
      } else toast.error(r.error || "清除失败");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="生效群"
        description={`按群开关机器人应答，并覆盖主动补位 / 转人工通知策略。${overrideCount ? `当前 ${overrideCount} 个群有独立策略。` : "未设置覆盖时全部跟随全局配置。"}`}
      />

      {globals && (
        <MetricBadgeRow>
          <MetricBadge
            icon={Zap}
            label="主动补位"
            value={globals.proactiveEnabled ? "开" : "关"}
            tone={globals.proactiveEnabled ? "primary" : undefined}
          />
          <MetricBadge icon={Timer} label="静默阈值" value={min(globals.proactiveSilenceMs)} />
          <MetricBadge icon={Bell} label="转人工通知" value="开" tone="primary" />
          {overrideCount > 0 && (
            <MetricBadge icon={Settings2} label="独立策略" value={`${overrideCount} 群`} />
          )}
        </MetricBadgeRow>
      )}

      <SectionCard title="群活动与策略" icon={Users} description="可在配置页修改全局默认；表格内可按群覆盖。">
        <DataState
          loading={loading}
          error={error}
          empty={rows.length === 0}
          onRetry={refresh}
          emptyIcon={Users}
          emptyTitle="暂无群活动"
          emptyDescription="生效群有消息后会出现在这里。也可先在配置页勾选生效群。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>群</TableHead>
                <TableHead>生效</TableHead>
                <TableHead>主动补位</TableHead>
                <TableHead>静默</TableHead>
                <TableHead>转人工通知</TableHead>
                <TableHead className="text-right">消息量</TableHead>
                <TableHead>最近活动</TableHead>
                <TableHead className="w-28">策略</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.groupId}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col gap-0.5">
                      <span>{name(r.groupId)}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">{r.groupId}</span>
                    </div>
                  </TableCell>
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
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={r.effective.proactiveEnabled ? "default" : "secondary"}>
                        {r.effective.proactiveEnabled ? "开" : "关"}
                      </Badge>
                      {r.policy.proactiveEnabled !== undefined && (
                        <span className="text-muted-foreground text-[10px]">覆盖</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="tabular-nums text-sm">{min(r.effective.proactiveSilenceMs)}</span>
                      {r.policy.proactiveSilenceMs !== undefined && (
                        <span className="text-muted-foreground text-[10px]">覆盖</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={r.effective.notifyAdminOnHandoff ? "outline" : "secondary"}>
                        {r.effective.notifyAdminOnHandoff ? "通知" : "静默"}
                      </Badge>
                      {r.policy.notifyAdminOnHandoff !== undefined && (
                        <span className="text-muted-foreground text-[10px]">覆盖</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.messageCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.lastTs ? <RelativeTime ts={r.lastTs} /> : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openEditor(r)}>
                        <Settings2 data-icon="inline-start" />
                        编辑
                      </Button>
                      {r.hasOverride && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.groupId}
                          title="清除覆盖，跟随全局"
                          onClick={() => clearPolicy(r.groupId)}
                        >
                          <RotateCcw data-icon="inline-start" />
                          清除
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataState>
      </SectionCard>

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>群策略 · {editing ? name(editing.groupId) : ""}</SheetTitle>
            <SheetDescription>
              未覆盖的项跟随全局配置。
              {globals && (
                <>
                  {" "}当前全局:主动 {globals.proactiveEnabled ? "开" : "关"} · 静默 {min(globals.proactiveSilenceMs)} ·
                  转人工通知开。
                </>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-2">
            <FieldGroup>
              <Field>
                <FieldLabel>主动补位</FieldLabel>
                <Select value={proactiveTri} onValueChange={(v) => setProactiveTri(v as Tri)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">跟随全局</SelectItem>
                    <SelectItem value="on">强制开启</SelectItem>
                    <SelectItem value="off">强制关闭</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>核心群可强制开,闲聊群可强制关。</FieldDescription>
              </Field>

              <Field>
                <FieldLabel>静默阈值</FieldLabel>
                <Select
                  value={silenceMode}
                  onValueChange={(v) => setSilenceMode(v as "inherit" | "custom")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      跟随全局{globals ? ` (${min(globals.proactiveSilenceMs)})` : ""}
                    </SelectItem>
                    <SelectItem value="custom">自定义(分钟)</SelectItem>
                  </SelectContent>
                </Select>
                {silenceMode === "custom" && (
                  <Input
                    className="mt-2"
                    inputMode="numeric"
                    value={silenceMin}
                    onChange={(e) => setSilenceMin(e.target.value)}
                    placeholder="分钟"
                  />
                )}
                <FieldDescription>无人应答超过此时长才主动补位。</FieldDescription>
              </Field>

              <Field>
                <FieldLabel>转人工时通知管理群</FieldLabel>
                <Select value={handoffTri} onValueChange={(v) => setHandoffTri(v as Tri)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">跟随默认(通知)</SelectItem>
                    <SelectItem value="on">通知</SelectItem>
                    <SelectItem value="off">不通知</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>仅控制转人工时是否向管理群发消息;会话仍会进入人工接待。</FieldDescription>
              </Field>
            </FieldGroup>
          </div>

          <SheetFooter className="flex-row gap-2 border-t">
            {editing?.hasOverride && (
              <Button
                variant="outline"
                disabled={savingPolicy}
                onClick={() => editing && clearPolicy(editing.groupId)}
              >
                <RotateCcw data-icon="inline-start" />
                全部跟随全局
              </Button>
            )}
            <Button onClick={savePolicy} disabled={savingPolicy}>
              {savingPolicy ? <Spinner data-icon="inline-start" /> : null}
              {savingPolicy ? "保存中…" : "保存策略"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
