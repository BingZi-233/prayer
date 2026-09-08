"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { DEFAULT_BRAND } from "@/lib/brand"

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
  brandName?: string
  brandDescription?: string
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
  // 在飞的请求(闸门:慢接口下裸轮询会无脑堆请求,曾把生产打成 502 的模式)
  const inFlight = useRef<Promise<void> | null>(null)
  // 暴露给消费方的主动刷新:指向最新一轮 effect 里的 load
  const loadRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load(): Promise<void> {
      if (inFlight.current) return inFlight.current
      const p = (async () => {
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
          // 并发 load 已被开头闸门挡住,能走到结束的只有本轮 → 直接置空即可
          inFlight.current = null
        }
      })()
      inFlight.current = p
      return p
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

  // tab 标题:有人工会话 → "(N) Prayer · 客服 Agent"
  useEffect(() => {
    const n = overview?.humanSessions ?? 0
    const brandName = overview?.brandName?.trim() || DEFAULT_BRAND.name
    document.title =
      n > 0 ? `(${n}) ${brandName} · 客服 Agent` : `${brandName} · 客服 Agent`
  }, [overview?.brandName, overview?.humanSessions])

  // 主动刷新:等在飞的落地后再补一发,确保拿到调用时刻之后的数据
  // (restart 后必须 —— 直接 load 会撞闸门空转,旧数据还能写进 state)
  const refresh = useCallback(async () => {
    while (inFlight.current) {
      await inFlight.current.catch(() => {})
    }
    return loadRef.current()
  }, [])

  return (
    <LiveCtx.Provider value={{ status, overview, lastUpdated, refresh }}>
      {children}
    </LiveCtx.Provider>
  )
}
