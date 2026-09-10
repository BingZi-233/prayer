import type { ReactNode } from "react"
import { cn } from "@/lib/core/utils"

// 统一内容列表项:反思条目 / 主动回复 / 能力条目 / 知识块 等。
// meta 为顶栏(徽章、时间、操作);children 为正文。
export function ItemCard({
  meta,
  children,
  className,
}: {
  meta?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border/70 bg-card/50 p-3 shadow-xs ring-1 ring-foreground/5",
        className
      )}
    >
      {meta != null && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {meta}
        </div>
      )}
      {children}
    </div>
  )
}
