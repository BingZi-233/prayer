import type { ReactNode } from "react"
import { cn } from "@/lib/core/utils"

// 统一表格外壳:圆角边框 + 限高滚动 + 吸顶表头(吸顶样式见 globals.css 的
// [data-slot="table-shell"] 规则)。限高让长表格在自身容器内滚动,
// 表头始终可见,页面整体不被撑高。
//
// 直接渲染 <table> 而不复用 components/ui/table.tsx 的 Table:
// Table 会再包一层 overflow-x-auto,那层会成为表头的最近滚动容器,
// 吸顶随之失效(它自身没有高度约束,永远不滚)。
export function TableShell({
  children,
  className,
  minWidth,
  maxHeight = "max-h-[calc(100svh-22rem)]",
}: {
  children: ReactNode
  className?: string
  /** 列较多时给表格一个最小宽度,窄屏横向滚动而不是挤压列 */
  minWidth?: string
  maxHeight?: string
}) {
  return (
    <div
      data-slot="table-shell"
      className={cn(
        "relative overflow-auto rounded-lg border",
        maxHeight,
        className
      )}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-xs", minWidth)}
      >
        {children}
      </table>
    </div>
  )
}
