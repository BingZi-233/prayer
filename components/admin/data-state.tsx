import type { ComponentType, ReactNode } from "react"
import { TriangleAlert } from "lucide-react"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Button } from "@/components/ui/button"

// 统一空态:图标 + 标题 + 可选描述。全站空态收敛到此,不再裸 <p>/<span>。
export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon?: ComponentType
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <Empty className="min-h-32 py-8" role="status" aria-live="polite">
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  )
}

// 统一错误态:告警图标 + 文案 + 可选重试。取代 destructive Card / 裸红字 / 静默 三种写法。
export function ErrorState({
  title = "加载失败",
  description,
  onRetry,
}: {
  title?: ReactNode
  description?: ReactNode
  onRetry?: () => void
}) {
  return (
    <Empty className="min-h-32 py-8" role="status" aria-live="polite">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {onRetry && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

// 载/错/空/内容 四态收敛到一处,顺序固定,消除"空态兼作载态"的首屏闪烁。
// loading 时渲染传入的 skeleton;error 优先于 empty;都不满足才渲染 children。
export function DataState({
  loading,
  error,
  empty,
  skeleton,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  onRetry,
  children,
}: {
  loading?: boolean
  error?: string | null
  empty?: boolean
  skeleton?: ReactNode
  emptyIcon?: ComponentType
  emptyTitle?: ReactNode
  emptyDescription?: ReactNode
  onRetry?: () => void
  children: ReactNode
}) {
  if (loading) return <>{skeleton}</>
  if (error) return <ErrorState description={error} onRetry={onRetry} />
  if (empty)
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  return <>{children}</>
}
