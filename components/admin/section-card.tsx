import type { ComponentType, ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("min-h-0", className)}>
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2">
          {Icon && <Icon className="size-4 shrink-0" />}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children != null && <CardContent className={cn("min-h-0", contentClassName)}>{children}</CardContent>}
    </Card>
  );
}
