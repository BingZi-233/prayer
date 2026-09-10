"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Users, Settings2, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableShell } from "@/components/admin/table-shell"
import { RowActions } from "@/components/admin/row-actions"
import { RelativeTime } from "@/components/relative-time"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { MetricRows } from "@/components/admin/stat"
import { DataState } from "@/components/admin/data-state"
import { usePolling } from "@/components/admin/use-polling"
import { useGroupNames } from "@/lib/group-name"

type Tri = "inherit" | "on" | "off"

type ChannelId = "qq" | "tg" | "discord"

interface GroupPolicy {
  proactiveEnabled?: boolean
  proactiveSilenceMs?: number
  notifyAdminOnHandoff?: boolean
}

interface Row {
  channel: ChannelId
  chatId: string
  /** 兼容旧字段；勿作主键 */
  groupId: number
  /** 管理群：只跑管理命令，不可勾生效、无策略 */
  isAdmin?: boolean
  enabled: boolean
  messageCount: number
  lastTs: number
  cursor: number
  sedimentedCount: number
  policy: GroupPolicy
  hasOverride: boolean
  policyKey: string
  effective: {
    proactiveEnabled: boolean
    proactiveSilenceMs: number
    notifyAdminOnHandoff: boolean
  }
}

interface Globals {
  proactiveEnabled: boolean
  proactiveSilenceMs: number
  notifyAdminOnHandoff: true
}

interface ActivityData {
  groups: Row[]
  globals: Globals
}

const min = (ms: number) => `${Math.round(ms / 60_000)} 分`

function triFrom(v: boolean | undefined): Tri {
  if (v === undefined) return "inherit"
  return v ? "on" : "off"
}

function triToBool(t: Tri): boolean | undefined {
  if (t === "inherit") return undefined
  return t === "on"
}

function rowLabel(
  r: Pick<Row, "channel" | "chatId" | "groupId">,
  nameFn: (id: number) => string
): string {
  if (r.channel === "qq" && r.groupId > 0) return nameFn(r.groupId)
  if (r.channel === "tg" && r.groupId !== 0) {
    const n = nameFn(r.groupId)
    if (n && n !== String(r.groupId)) return n
  }
  return r.chatId
}

function channelLabel(c: ChannelId): string {
  if (c === "qq") return "QQ"
  if (c === "tg") return "TG"
  return c
}

/**
 * 策略写 payload：新键 policyKey；QQ 同时清掉历史裸群号键，避免 getGroupPolicy 回退读到旧覆盖。
 */
function policyWritePayload(
  row: Pick<Row, "channel" | "chatId" | "policyKey">,
  policy: GroupPolicy | null
): Record<string, GroupPolicy | null> {
  const out: Record<string, GroupPolicy | null> = { [row.policyKey]: policy }
  if (row.channel === "qq" && row.chatId) {
    out[row.chatId] = null
  }
  return out
}

export default function GroupsPage() {
  const { data, error, loading, refresh } = usePolling<ActivityData>(
    "/api/groups/activity"
  )
  const { name } = useGroupNames()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const [savingPolicy, setSavingPolicy] = useState(false)

  // 编辑表单状态
  const [proactiveTri, setProactiveTri] = useState<Tri>("inherit")
  const [silenceMode, setSilenceMode] = useState<"inherit" | "custom">(
    "inherit"
  )
  const [silenceMin, setSilenceMin] = useState("3")
  const [handoffTri, setHandoffTri] = useState<Tri>("inherit")

  // useMemo 固定引用:data 未变时 rows 不变,下游 useMemo 依赖才稳定
  const rows = useMemo(() => data?.groups ?? [], [data?.groups])
  const globals = data?.globals

  const overrideCount = useMemo(
    () => rows.filter((r) => r.hasOverride).length,
    [rows]
  )

  function openEditor(r: Row) {
    setEditing(r)
    setProactiveTri(triFrom(r.policy.proactiveEnabled))
    if (r.policy.proactiveSilenceMs !== undefined) {
      setSilenceMode("custom")
      setSilenceMin(String(Math.round(r.policy.proactiveSilenceMs / 60_000)))
    } else {
      setSilenceMode("inherit")
      setSilenceMin(
        String(Math.round((globals?.proactiveSilenceMs ?? 180_000) / 60_000))
      )
    }
    setHandoffTri(triFrom(r.policy.notifyAdminOnHandoff))
  }

  async function toggle(row: Row, enable: boolean) {
    setBusyKey(row.policyKey)
    try {
      const cur = await fetch("/api/config").then((x) => x.json())
      if (!cur.ok) {
        toast.error(cur.error || "读取配置失败")
        return
      }
      type ChatRef = { channel: string; chatId: string }
      const chats: ChatRef[] = Array.isArray(cur.data.enabledChats)
        ? [...cur.data.enabledChats]
        : []
      const others = chats.filter(
        (c) => !(c.channel === row.channel && c.chatId === row.chatId)
      )
      const next: ChatRef[] = enable
        ? [...others, { channel: row.channel, chatId: row.chatId }]
        : others
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledChats: next }),
      }).then((x) => x.json())
      if (r.ok) {
        const label = `${channelLabel(row.channel)} · ${rowLabel(row, name)}`
        toast.success(enable ? `已生效: ${label}` : `已关闭: ${label}`)
        if (enable) {
          toast.message("用法提示", {
            description:
              "群内问 bot 请 @机器人;重置请 @机器人 后发「重置」;转人工请 @机器人 后发「人工」(单独发无效)。",
          })
        }
        await refresh({ force: true })
      } else {
        toast.error(r.error || "保存失败")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyKey(null)
    }
  }

  async function savePolicy() {
    if (!editing) return
    setSavingPolicy(true)
    try {
      const policy: GroupPolicy = {}
      const pe = triToBool(proactiveTri)
      if (pe !== undefined) policy.proactiveEnabled = pe
      if (silenceMode === "custom") {
        const m = Number(silenceMin)
        if (!Number.isFinite(m) || m < 0) {
          toast.error("静默阈值须为非负数字(分钟)")
          return
        }
        policy.proactiveSilenceMs = Math.round(m * 60_000)
      }
      const nh = triToBool(handoffTri)
      if (nh !== undefined) policy.notifyAdminOnHandoff = nh

      const groupPolicies =
        Object.keys(policy).length === 0
          ? policyWritePayload(editing, null)
          : policyWritePayload(editing, policy)

      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupPolicies }),
      }).then((x) => x.json())
      if (r.ok) {
        toast.success(
          `已保存 ${channelLabel(editing.channel)} · ${rowLabel(editing, name)} 的策略`
        )
        setEditing(null)
        await refresh({ force: true })
      } else {
        toast.error(r.error || "保存失败")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingPolicy(false)
    }
  }

  async function clearPolicy(row: Row) {
    setBusyKey(row.policyKey)
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupPolicies: policyWritePayload(row, null),
        }),
      }).then((x) => x.json())
      if (r.ok) {
        toast.success(
          `已恢复跟随全局: ${channelLabel(row.channel)} · ${rowLabel(row, name)}`
        )
        if (editing?.policyKey === row.policyKey) setEditing(null)
        await refresh({ force: true })
      } else toast.error(r.error || "清除失败")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="生效会话"
        description="按会话开关机器人应答，并覆盖主动补位 / 转人工通知策略；未覆盖的项跟随全局，管理群只处理 !reset / !resume，不参与客服问答。"
      />

      {globals && (
        <MetricRows
          items={[
            {
              label: "全局主动补位",
              value: globals.proactiveEnabled ? "开" : "关",
              hint: "可在配置页修改默认;单群可在此覆盖。",
            },
            {
              label: "全局静默阈值",
              value: min(globals.proactiveSilenceMs),
              hint: "无人应答超过此时长才补位。",
            },
            {
              label: "转人工通知",
              value: "开",
              hint: "转人工时向管理面发消息提醒。",
            },
            {
              label: "独立策略",
              value: overrideCount,
              hint: "覆盖了全局默认的会话数量。",
            },
          ]}
        />
      )}

      <DataState
          loading={loading}
          error={error}
          empty={rows.length === 0}
          onRetry={refresh}
          emptyIcon={Users}
          emptyTitle="暂无会话活动"
          emptyDescription="生效会话有消息后会出现在这里。也可先在配置页勾选生效会话。"
          skeleton={<Skeleton className="h-40 w-full" />}
        >
          <TableShell minWidth="min-w-[880px]">
            <TableHeader>
              <TableRow>
                <TableHead>会话</TableHead>
                <TableHead>生效</TableHead>
                <TableHead>主动补位</TableHead>
                <TableHead>静默</TableHead>
                <TableHead>转人工通知</TableHead>
                <TableHead className="text-right">消息量</TableHead>
                <TableHead>最近活动</TableHead>
                <TableHead className="w-12 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.policyKey}>
                  <TableCell className="max-w-[320px] font-medium">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="px-1.5 text-[10px]">
                        {channelLabel(r.channel)}
                      </Badge>
                      <span className="truncate">{rowLabel(r, name)}</span>
                      {rowLabel(r, name) !== r.chatId && (
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {r.chatId}
                        </span>
                      )}
                      {r.isAdmin && (
                        <Badge
                          variant="secondary"
                          className="px-1.5 text-[10px]"
                        >
                          管理群
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.isAdmin ? (
                      <span className="text-xs text-muted-foreground">
                        仅管理命令
                      </span>
                    ) : (
                      <Switch
                        checked={r.enabled}
                        disabled={busyKey === r.policyKey}
                        onCheckedChange={(v) => toggle(r, v)}
                        aria-label={`${r.enabled ? "关闭" : "开启"} ${rowLabel(r, name)} 的自动应答`}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {r.isAdmin ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={
                            r.effective.proactiveEnabled
                              ? "default"
                              : "secondary"
                          }
                        >
                          {r.effective.proactiveEnabled ? "开" : "关"}
                        </Badge>
                        {r.policy.proactiveEnabled !== undefined && (
                          <span className="text-[10px] text-muted-foreground">
                            覆盖
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.isAdmin ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm tabular-nums">
                          {min(r.effective.proactiveSilenceMs)}
                        </span>
                        {r.policy.proactiveSilenceMs !== undefined && (
                          <span className="text-[10px] text-muted-foreground">
                            覆盖
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.isAdmin ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={
                            r.effective.notifyAdminOnHandoff
                              ? "outline"
                              : "secondary"
                          }
                        >
                          {r.effective.notifyAdminOnHandoff ? "通知" : "静默"}
                        </Badge>
                        {r.policy.notifyAdminOnHandoff !== undefined && (
                          <span className="text-[10px] text-muted-foreground">
                            覆盖
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.messageCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.lastTs ? <RelativeTime ts={r.lastTs} /> : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.isAdmin ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <RowActions
                        items={[
                          {
                            key: "edit",
                            label: "编辑策略",
                            icon: <Settings2 />,
                            onSelect: () => openEditor(r),
                          },
                          ...(r.hasOverride
                            ? [
                                {
                                  key: "clear",
                                  label: "清除覆盖",
                                  icon: <RotateCcw />,
                                  separatorBefore: true,
                                  disabled: busyKey === r.policyKey,
                                  onSelect: () => void clearPolicy(r),
                                },
                              ]
                            : []),
                        ]}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableShell>
        </DataState>

      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      >
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              会话策略 ·{" "}
              {editing
                ? `${channelLabel(editing.channel)} · ${rowLabel(editing, name)}`
                : ""}
            </SheetTitle>
            <SheetDescription>
              未覆盖的项跟随全局配置。
              {editing && (
                <>
                  {" "}
                  <span className="font-mono text-xs">{editing.policyKey}</span>
                </>
              )}
              {globals && (
                <>
                  {" "}
                  当前全局:主动 {globals.proactiveEnabled ? "开" : "关"} · 静默{" "}
                  {min(globals.proactiveSilenceMs)} · 转人工通知开。
                </>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-2">
            <FieldGroup>
              <Field>
                <FieldLabel>主动补位</FieldLabel>
                <Select
                  items={{
                    inherit: "跟随全局",
                    on: "强制开启",
                    off: "强制关闭",
                  }}
                  value={proactiveTri}
                  onValueChange={(v) => {
                    if (v !== null) setProactiveTri(v as Tri)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">跟随全局</SelectItem>
                    <SelectItem value="on">强制开启</SelectItem>
                    <SelectItem value="off">强制关闭</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  核心群可强制开,闲聊群可强制关。
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>静默阈值</FieldLabel>
                <Select
                  items={{
                    inherit: "跟随全局",
                    custom: "自定义(分钟)",
                  }}
                  value={silenceMode}
                  onValueChange={(v) => {
                    if (v !== null) setSilenceMode(v as "inherit" | "custom")
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      跟随全局
                      {globals ? ` (${min(globals.proactiveSilenceMs)})` : ""}
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
                <FieldDescription>
                  无人应答超过此时长才主动补位。
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>转人工时通知管理面</FieldLabel>
                <Select
                  items={{
                    inherit: "跟随默认(通知)",
                    on: "通知",
                    off: "不通知",
                  }}
                  value={handoffTri}
                  onValueChange={(v) => {
                    if (v !== null) setHandoffTri(v as Tri)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">跟随默认(通知)</SelectItem>
                    <SelectItem value="on">通知</SelectItem>
                    <SelectItem value="off">不通知</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  仅控制转人工时是否向管理面发消息;会话仍会进入人工接待。
                </FieldDescription>
              </Field>
            </FieldGroup>
          </div>

          <SheetFooter className="flex-row gap-2 border-t">
            {editing?.hasOverride && (
              <Button
                variant="outline"
                disabled={savingPolicy}
                onClick={() => editing && clearPolicy(editing)}
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
  )
}
