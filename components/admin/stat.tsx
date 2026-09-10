import type { ReactNode } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** 指标卡:小标签 + 大数字 + 一行说明。全站 KPI 统一用此,不用徽章行。 */
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
    <Card className={cn("gap-3", className)}>
      <CardHeader className="gap-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("text-2xl tabular-nums", warn && "text-destructive")}>
          {loading ? <Skeleton className="h-7 w-16" /> : value}
        </CardTitle>
      </CardHeader>
      {hint != null && (
        <CardContent className="text-xs text-muted-foreground">
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
