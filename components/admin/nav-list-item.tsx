import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/core/utils"

// 统一左栏列表项(选中/hover 态一致)。取代 sessions / kb 各自手写的 <button>+cn。
export function NavListItem({
  active,
  onClick,
  icon: Icon,
  badge,
  children,
}: {
  active?: boolean
  onClick?: () => void
  icon?: ComponentType<{ className?: string }>
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
        active && "bg-muted font-medium"
      )}
    >
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="truncate">{children}</span>
      {badge != null && <span className="ml-auto shrink-0">{badge}</span>}
    </button>
  )
}
