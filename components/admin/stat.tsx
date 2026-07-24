import type { ComponentType, ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** 指标徽章:标签 + 数值,可标警示 / 主色。全站 KPI 统一用此,不再用卡片网格。 */
export function MetricBadge({
  label,
  value,
  icon: Icon,
  warn,
  tone,
  loading,
  className,
}: {
  label: string
  value: ReactNode
  icon?: ComponentType<{ className?: string }>
  warn?: boolean
  tone?: "primary"
  loading?: boolean
  className?: string
}) {
  return (
    <Badge
      variant={
        warn ? "destructive" : tone === "primary" ? "default" : "secondary"
      }
      className={cn(
        "h-8 gap-1.5 px-2.5 text-xs font-normal",
        !warn && tone !== "primary" && "bg-muted text-foreground",
        className
      )}
    >
      {Icon && <Icon className="size-3 opacity-70" />}
      <span
        className={cn(
          tone === "primary" || warn ? "opacity-80" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-3.5 w-6" />
      ) : (
        <span className="font-semibold tabular-nums">{value}</span>
      )}
    </Badge>
  )
}

/** 徽章横排容器。 */
export function MetricBadgeRow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn("flex flex-wrap gap-2", className)}>{children}</div>
}
