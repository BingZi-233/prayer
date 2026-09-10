import type { ReactNode } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/core/utils"

/** 指标卡:小标签 + 大数字 + 一行说明。用于少量核心 KPI(概览页)。 */
export function StatCard({
  label,
  value,
  hint,
  warn,
  loading,
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  warn?: boolean
  loading?: boolean
  className?: string
}) {
  return (
    <Card size="sm" className={cn("gap-2 py-3", className)}>
      <CardHeader className="gap-0.5">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("text-xl tabular-nums", warn && "text-destructive")}>
          {loading ? <Skeleton className="h-6 w-14" /> : value}
        </CardTitle>
      </CardHeader>
      {hint != null && (
        <CardContent className="text-[11px] text-muted-foreground">
          {hint}
        </CardContent>
      )}
    </Card>
  )
}

/** 指标卡网格。 */
export function StatGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-4", className)}>
      {children}
    </div>
  )
}

export interface MetricRowItem {
  label: ReactNode
  value: ReactNode
  /** 鼠标悬停时补充说明(替代占一行的 hint) */
  hint?: string
  warn?: boolean
}

/**
 * 密集指标行:标签居左、数值居右的单行格子。
 * 配置型参数(周期/阈值/计数)用它 —— 卡片网格太占纵向空间,
 * 一屏塞不下正文时才用卡片。
 */
export function MetricRows({
  items,
  className,
}: {
  items: MetricRowItem[]
  className?: string
}) {
  return (
    <div
      className={cn("grid gap-2 sm:grid-cols-2 xl:grid-cols-4", className)}
    >
      {items.map((item, i) => (
        <div
          key={i}
          title={item.hint}
          className="flex items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-xs"
        >
          <span className="truncate text-muted-foreground">{item.label}</span>
          <span
            className={cn(
              "shrink-0 font-medium tabular-nums",
              item.warn && "text-destructive"
            )}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/** 指标行的加载骨架。 */
export function MetricRowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}
