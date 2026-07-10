import type { ComponentType, ReactNode } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// 统一 KPI 网格。默认 1/2/4 列响应式,可 className 覆盖列数。
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>;
}

// 统一 KPI 卡:图标+标签(描述)在上,数值(标题)在下。loading 时数值位显示骨架。
// 取代全站三种统计呈现(每指标一卡 / 内联 Stat / 空 body 卡)。
export function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {Icon && <Icon className="size-3.5 shrink-0" />}
          <span className="truncate">{label}</span>
        </CardDescription>
        <CardTitle className="text-xl tabular-nums">
          {loading ? <Skeleton className="h-6 w-14" /> : value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
