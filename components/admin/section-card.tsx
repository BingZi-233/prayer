import type { ReactNode } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/core/utils"

// 区块卡:标题 + 可选描述 + 可选右上操作位 + 内容。
// 不加图标、不加底色、不加分隔线,靠间距分组。
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card className={cn("min-h-0 overflow-hidden", className)}>
      <CardHeader className="shrink-0">
        <CardTitle>{title}</CardTitle>
        {description && (
          <CardDescription className="text-xs sm:text-sm">
            {description}
          </CardDescription>
        )}
        {action && (
          <CardAction className="flex flex-wrap items-center gap-2">
            {action}
          </CardAction>
        )}
      </CardHeader>
      {children != null && (
        <CardContent className={cn("min-h-0", contentClassName)}>
          {children}
        </CardContent>
      )}
    </Card>
  )
}
