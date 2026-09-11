import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/core/utils"
import { sessionKeyParts } from "@/lib/core/chat/group-name"
import { channelLabel } from "@/lib/core/chat/channel-labels"

/** 从来源 session key 解析渠道，展示为小徽章 */
export function ChannelBadge({
  sessionKey,
  className,
}: {
  sessionKey: string
  className?: string
}) {
  const channel = sessionKeyParts(sessionKey)?.channel ?? "qq"
  const label = channelLabel(channel)
  return (
    <Badge
      variant="secondary"
      className={cn(
        "h-4 shrink-0 border-transparent bg-foreground px-1 text-[10px] text-background",
        className
      )}
      title={`来源渠道: ${label}`}
    >
      {label}
    </Badge>
  )
}
