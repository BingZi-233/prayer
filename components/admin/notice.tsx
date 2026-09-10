import type { ReactNode } from "react"
import { CircleAlert, CircleCheck, Info } from "lucide-react"
import { cn } from "@/lib/utils"

// 提示条:与背景同色的浅色底 + 同色描边,用于"需要注意但不是错误"的说明。
// 页面上同类提示只有这一处实现,不要各页手写彩色横幅。
const variants = {
  info: {
    icon: Info,
    className:
      "border-blue-500/20 bg-blue-500/5 text-blue-700 dark:text-blue-300",
  },
  warning: {
    icon: CircleAlert,
    className:
      "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  },
  success: {
    icon: CircleCheck,
    className:
      "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  },
} as const

export function Notice({
  title,
  description,
  variant = "info",
  icon,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  variant?: keyof typeof variants
  /** 覆盖默认图标 */
  icon?: ReactNode
  /** 可选操作区(链接、按钮),渲染在说明下方 */
  children?: ReactNode
  className?: string
}) {
  const Icon = variants[variant].icon

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        variants[variant].className,
        className
      )}
    >
      <span className="mt-0.5 shrink-0">
        {icon ?? <Icon className="size-4" />}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{title}</p>
        {description && <p className="text-current/80">{description}</p>}
        {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
      </div>
    </div>
  )
}
