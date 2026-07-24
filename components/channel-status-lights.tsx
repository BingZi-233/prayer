"use client"

import { cn } from "@/lib/utils"
import type { ChannelStatusView } from "@/components/live-provider"

const CHANNEL_LABEL: Record<string, string> = {
  qq: "QQ",
  tg: "TG",
  discord: "Discord",
}

/** 单通道状态点 + 短标签（header / 首页共用） */
export function ChannelDot({
  ch,
  compact,
}: {
  ch: ChannelStatusView
  /** header 用更短文案 */
  compact?: boolean
}) {
  const label = CHANNEL_LABEL[ch.id] ?? ch.id.toUpperCase()
  const err = !!ch.lastError
  const on = ch.connected && !err
  const title = [
    label,
    on ? "已连接" : err ? "异常" : "断开",
    ch.detail,
    ch.lastError,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          on && "animate-pulse bg-primary",
          !on && err && "bg-destructive",
          !on && !err && "bg-muted-foreground/50"
        )}
      />
      <span className="text-muted-foreground">
        {compact
          ? label
          : on
            ? `${label} 已连接`
            : err
              ? `${label} 异常`
              : `${label} 断开`}
      </span>
    </span>
  )
}

/** 多通道横排；无 channels 时回退 wsConnected（兼容旧 status） */
export function ChannelStatusLights({
  channels,
  wsConnected,
  compact,
  className,
}: {
  channels?: ChannelStatusView[] | null
  /** 无 channels 时的 QQ 兼容字段 */
  wsConnected?: boolean
  compact?: boolean
  className?: string
}) {
  const list =
    channels && channels.length > 0
      ? channels
      : wsConnected !== undefined
        ? [{ id: "qq", connected: wsConnected }]
        : []

  if (!list.length) {
    return (
      <span className={cn("text-muted-foreground", className)}>通道 …</span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-2.5 gap-y-1",
        className
      )}
    >
      {list.map((ch) => (
        <ChannelDot key={ch.id} ch={ch} compact={compact} />
      ))}
    </span>
  )
}
