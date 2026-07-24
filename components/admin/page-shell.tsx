import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

// 全站页面容器:统一主间距 gap-6。
// fill=true 用于会话/知识库/运行状态等满高工作台,由 layout 传导高度,禁止页面内硬算 100svh。
// p-px: Card 用 ring-1 画边,父级 overflow 会裁掉左右 ring;留 1px 空隙避免边框消失。
export function PageShell({
  fill,
  className,
  children,
}: {
  fill?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6 p-px",
        fill && "min-h-0 flex-1 overflow-hidden",
        className
      )}
    >
      {children}
    </div>
  )
}
