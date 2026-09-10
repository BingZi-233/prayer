import type { ComponentType, ReactNode } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

// 统一区块卡:标题(可带图标)+ 可选描述 + 可选右上操作位 + 内容。
// 固定 CardTitle 字号、描述槽恒在,消除各页 CardTitle 字号/description 有无的不齐。
export function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ComponentType<{ className?: string }>
  action?: ReactNode
  children?: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card className={cn("min-h-0 overflow-hidden shadow-sm", className)}>
      <CardHeader className="shrink-0 border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-4">
        <CardTitle className="flex items-center gap-2">
          {Icon && <Icon className="size-4 shrink-0" />}
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>}
        {action && (
          <CardAction className="flex flex-wrap items-center gap-2">
            {action}
          </CardAction>
        )}
      </CardHeader>
      {children != null && (
        <CardContent className={cn("min-h-0 px-4 py-3.5 sm:px-4 sm:py-4", contentClassName)}>
          {children}
        </CardContent>
      )}
    </Card>
  )
}
