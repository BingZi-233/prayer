import type { ReactNode } from "react"
import { TabsContent } from "@/components/ui/tabs"

/**
 * 配置区块既可以独立作为旧式标签页渲染,也可以嵌入新的分类面板。
 * 保留独立模式方便区块复用,分类页则用 embedded 把多个相关区块放在一起。
 */
export function ConfigTabContent({
  value,
  embedded = false,
  children,
}: {
  value: string
  embedded?: boolean
  children: ReactNode
}) {
  if (embedded) return <>{children}</>
  return <TabsContent value={value}>{children}</TabsContent>
}
