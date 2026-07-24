"use client"

import { useEffect, useState } from "react"

function rel(ts: number, now: number): string {
  const diff = now - ts
  if (diff < 0) return "刚刚"
  const s = Math.floor(diff / 1000)
  if (s < 60) return "刚刚"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(ts).toLocaleDateString()
}

// 相对时间;title 挂绝对时间;30s 刷新保持新鲜
export function RelativeTime({ ts }: { ts: number | null | undefined }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  if (!ts) return <span>—</span>
  return (
    <span title={new Date(ts).toLocaleString()} suppressHydrationWarning>
      {rel(ts, now)}
    </span>
  )
}
