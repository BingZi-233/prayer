import { Settings2, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
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
import { channelLabel } from "@/lib/core/chat/channel-labels"
import { formatDuration } from "@/lib/core/format-duration"
import { rowLabel } from "./policy-payload"
import type { Row } from "./types"

interface GroupTableProps {
  rows: Row[]
  name: (id: number) => string
  busyKey: string | null
  onToggle: (row: Row, enable: boolean) => void
  onClearPolicy: (row: Row) => void
  onEdit: (row: Row) => void
}

export function GroupTable({
  rows,
  name,
  busyKey,
  onToggle,
  onClearPolicy,
  onEdit,
}: GroupTableProps) {
  return (
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
                  <Badge variant="secondary" className="px-1.5 text-[10px]">
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
                  onCheckedChange={(v) => onToggle(r, v)}
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
                      r.effective.proactiveEnabled ? "default" : "secondary"
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
                    {formatDuration(r.effective.proactiveSilenceMs)}
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
                      r.effective.notifyAdminOnHandoff ? "outline" : "secondary"
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
                      onSelect: () => onEdit(r),
                    },
                    ...(r.hasOverride
                      ? [
                          {
                            key: "clear",
                            label: "清除覆盖",
                            icon: <RotateCcw />,
                            separatorBefore: true,
                            disabled: busyKey === r.policyKey,
                            onSelect: () => void onClearPolicy(r),
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
  )
}
