"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Users } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { MetricRows } from "@/components/admin/stat"
import { DataState } from "@/components/admin/data-state"
import { usePolling } from "@/components/admin/use-polling"
import { useGroupNames } from "@/lib/core/chat/group-name"
import { channelLabel } from "@/lib/core/chat/channel-labels"
import { formatDuration } from "@/lib/core/format-duration"
import type {
  GroupPolicy,
  Row,
  ActivityData,
} from "@/components/admin/groups/types"
import {
  triToBool,
  rowLabel,
  policyWritePayload,
} from "@/components/admin/groups/policy-payload"
import { useGroupPolicyForm } from "@/components/admin/groups/use-group-policy-form"
import { GroupTable } from "@/components/admin/groups/group-table"
import { PolicySheet } from "@/components/admin/groups/policy-sheet"

export default function GroupsPage() {
  const { data, error, loading, refresh } = usePolling<ActivityData>(
    "/api/groups/activity"
  )
  const { name } = useGroupNames()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [savingPolicy, setSavingPolicy] = useState(false)

  const form = useGroupPolicyForm()

  // useMemo 固定引用:data 未变时 rows 不变,下游 useMemo 依赖才稳定
  const rows = useMemo(() => data?.groups ?? [], [data?.groups])
  const globals = data?.globals

  const overrideCount = useMemo(
    () => rows.filter((r) => r.hasOverride).length,
    [rows]
  )

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
    if (!form.editing) return
    setSavingPolicy(true)
    try {
      const policy: GroupPolicy = {}
      const pe = triToBool(form.proactiveTri)
      if (pe !== undefined) policy.proactiveEnabled = pe
      if (form.silenceMode === "custom") {
        const m = Number(form.silenceMin)
        if (!Number.isFinite(m) || m < 0) {
          toast.error("静默阈值须为非负数字(分钟)")
          return
        }
        policy.proactiveSilenceMs = Math.round(m * 60_000)
      }
      const nh = triToBool(form.handoffTri)
      if (nh !== undefined) policy.notifyAdminOnHandoff = nh

      const groupPolicies =
        Object.keys(policy).length === 0
          ? policyWritePayload(form.editing, null)
          : policyWritePayload(form.editing, policy)

      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupPolicies }),
      }).then((x) => x.json())
      if (r.ok) {
        toast.success(
          `已保存 ${channelLabel(form.editing.channel)} · ${rowLabel(form.editing, name)} 的策略`
        )
        form.closeEditor()
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
        if (form.editing?.policyKey === row.policyKey) form.closeEditor()
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
              value: formatDuration(globals.proactiveSilenceMs),
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
        <GroupTable
          rows={rows}
          name={name}
          busyKey={busyKey}
          onToggle={toggle}
          onClearPolicy={clearPolicy}
          onEdit={(r) => form.openEditor(r, globals)}
        />
      </DataState>

      <PolicySheet
        form={form}
        globals={globals}
        name={name}
        savingPolicy={savingPolicy}
        onSave={savePolicy}
        onClear={clearPolicy}
      />
    </PageShell>
  )
}
