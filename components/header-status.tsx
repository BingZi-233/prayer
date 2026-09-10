"use client"

import { useEffect, useState } from "react"
import { useLive } from "@/components/live-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { DEFAULT_BRAND } from "@/lib/brand"

const STATE_LABEL: Record<string, string> = {
  running: "运行中",
  stopped: "已停止",
  starting: "启动中",
  error: "错误",
}

const CHANNEL_LABEL: Record<string, string> = {
  qq: "QQ",
  tg: "TG",
  discord: "Discord",
}

// 顶栏保持轻:一行品牌、一行状态摘要(状态 · 通道 · 刷新时间),
// 右侧只留主题切换。状态细节(错误原因等)在「运行状态」页看。
export function HeaderStatus() {
  const { status, overview, lastUpdated } = useLive()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const brandName = overview?.brandName?.trim() || DEFAULT_BRAND.name

  const channels =
    status?.channels && status.channels.length > 0
      ? status.channels
      : status
        ? [{ id: "qq", connected: status.wsConnected }]
        : []

  const parts: string[] = []
  if (status) parts.push(STATE_LABEL[status.state] ?? status.state)
  for (const ch of channels) {
    const label = CHANNEL_LABEL[ch.id] ?? ch.id.toUpperCase()
    const err = "lastError" in ch && !!ch.lastError
    parts.push(`${label} ${ch.connected && !err ? "已连接" : err ? "异常" : "断开"}`)
  }
  if (lastUpdated) {
    const sec = Math.max(0, Math.floor((now - lastUpdated) / 1000))
    parts.push(`刷新于 ${sec}s 前`)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="min-w-0" suppressHydrationWarning>
        <p className="truncate text-xs font-medium">{brandName} · 客服 Agent</p>
        <p className="truncate text-[0.6875rem] text-muted-foreground">
          {parts.length > 0 ? parts.join(" · ") : "加载状态中…"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ThemeToggle />
      </div>
    </div>
  )
}
