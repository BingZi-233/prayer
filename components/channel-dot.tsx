"use client"

import { cn } from "@/lib/core/utils"
import { channelLabel } from "@/lib/core/chat/channel-labels"
import type { ChannelStatusView } from "@/components/live-provider"

/** 单通道状态点 + 短标签(配置页通道卡片用)。 */
export function ChannelDot({
  ch,
  compact,
}: {
  ch: ChannelStatusView
  /** 更短文案,只留通道名 */
  compact?: boolean
}) {
  const label = channelLabel(ch.id)
  const err = !!ch.lastError
  const on = ch.connected && !err
  const title = [label, on ? "已连接" : err ? "异常" : "断开", ch.detail]
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
