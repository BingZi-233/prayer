"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"

/** 与 RuntimeStatus.channels / ChannelStatus 对齐 */
export interface ChannelStatusView {
  id: string
  connected: boolean
  lastError?: string
  detail?: string
}

export interface Status {
  state: string
  wsConnected: boolean
  sessionCount: number
  handoffQueue: number
  lastError?: string
  bootedAt?: number
  channels?: ChannelStatusView[]
}

/** /api/overview 的结果指标(今日 0 点起) */
export interface OverviewMetrics {
  since: number
  auto: number
  proactive: number
  handoff: number
  error: number
  blocked: number
  proactiveSilent: number
  autoResolutionRate: number | null
  proactiveBad: number
  usageCostUsd: number
  usageBudgetUsd: number
}

export interface Overview {
  enabledChats: number
  reflectionCount: number
  humanSessions: number
  metrics?: OverviewMetrics
}
interface Live {
  status: Status | null
  overview: Overview | null
  lastUpdated: number | null
  /** 立即触发一次状态/总览刷新(轮询节流外的主动刷新,如重启后) */
  refresh: () => Promise<void>
}

const LiveCtx = createContext<Live>({
  status: null,
  overview: null,
  lastUpdated: null,
  refresh: async () => {},
})

export function useLive() {
  return useContext(LiveCtx)
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  // in-flight 闸门:慢接口下裸 setInterval 会无脑堆请求(曾把生产打成 502 的模式)
  const inFlight = useRef(false)
  // 暴露给消费方的主动刷新:指向最新一轮 effect 里的 load
  const loadRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      if (inFlight.current) return
      inFlight.current = true
      try {
        const [st, ov] = await Promise.all([
          fetch("/api/status").then((x) => x.json()),
          fetch("/api/overview").then((x) => x.json()),
        ])
        if (!alive) return
        if (st.ok) setStatus(st.data)
        if (ov.ok) setOverview(ov.data)
        setLastUpdated(Date.now())
      } catch {
        /* 轮询失败静默,保留上次值 */
      } finally {
        inFlight.current = false
      }
    }
    loadRef.current = load
    // 递归 setTimeout:上一发结束才排下一发;隐藏标签页跳过请求,回前台即恢复
    const tick = async () => {
      if (!document.hidden) await load()
      if (!alive) return
      timer = setTimeout(tick, 3000)
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  // tab 标题:有人工会话 → "(N) 客服 Agent"
  useEffect(() => {
    const n = overview?.humanSessions ?? 0
    document.title = n > 0 ? `(${n}) 客服 Agent` : "客服 Agent"
  }, [overview?.humanSessions])

  return (
    <LiveCtx.Provider
      value={{
        status,
        overview,
        lastUpdated,
        refresh: () => loadRef.current(),
      }}
    >
      {children}
    </LiveCtx.Provider>
  )
}
