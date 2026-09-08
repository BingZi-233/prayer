"use client"

import { DEFAULT_BRAND } from "@/lib/brand"
import { useLive } from "@/components/live-provider"

/** 管理后台顶栏的动态品牌名；未登录/加载中回退 Prayer。 */
export function BrandTitle() {
  const { overview } = useLive()
  const name = overview?.brandName?.trim() || DEFAULT_BRAND.name
  return (
    <span className="min-w-0 truncate text-sm font-medium">
      {name} · 客服 Agent
    </span>
  )
}
