"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** 连续失败时的退避上限:间隔翻倍但不超过 intervalMs 的这个倍数 */
const MAX_BACKOFF_FACTOR = 10

// 统一轮询数据 hook:折叠各页手写的 setInterval+fetch+错误处理。
// 返回 { data, error, loading, refresh }。首次响应前 loading=true;
// 之后轮询静默更新(不翻回 loading,避免每 3 秒闪骨架)。
//
// 三个保护(前两个缺一曾把生产打成 502):
// 1. in-flight 闸门 —— 上一发未回绝不再发。慢接口下 setInterval 会无脑堆请求,
//    Node 单线程 + 同步 sqlite 查询直接被压死;并发调用复用同一 Promise。
//    写操作后要读到新数据,用 refresh({ force: true }):它排在在飞请求之后再补一发。
// 2. 失败退避 —— 连续失败按 2 倍拉长间隔(上限 intervalMs × 10),成功即复位,
//    避免服务已经挂了还被前端持续锤。
// 3. 隐藏页跳过 —— document.hidden 时不再发请求(计时器继续,回到前台立即恢复),
//    后台标签页不再白白打接口;url 变更时旧响应按过期丢弃,不覆盖新数据。
export function usePolling<T>(url: string, intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 在飞的请求:并发的 refresh() 复用它,不叠加新请求
  const inFlight = useRef<Promise<void> | null>(null)
  const failures = useRef(0)
  // effect 是否还活着(卸载/url 变更后不再 setState、不再排下一发)
  const active = useRef(true)
  // 当前生效的 url:url 变更后,旧 url 的在飞响应按过期丢弃
  const urlRef = useRef(url)

  const run = useCallback(async () => {
    const p = (async () => {
      try {
        const r = await fetch(url).then((x) => x.json())
        if (!active.current || url !== urlRef.current) return
        if (r.ok) {
          setData(r.data as T)
          setError(null)
          failures.current = 0
        } else {
          setError(r.error ?? "加载失败")
          failures.current++
        }
      } catch (e) {
        failures.current++
        if (!active.current || url !== urlRef.current) return
        setError(e instanceof Error ? e.message : "网络错误")
      } finally {
        inFlight.current = null
        if (active.current) setLoading(false)
      }
    })()

    inFlight.current = p
    return p
  }, [url])

  const refresh = useCallback(
    async (opts?: { force?: boolean }) => {
      if (inFlight.current) {
        // 非 force:直接复用在飞的那一发
        if (!opts?.force) return inFlight.current
        // force:在飞的那发可能早于本次写操作,等它落地后再补一发拿新数据
        await inFlight.current.catch(() => {})
      }
      return run()
    },
    [run]
  )

  useEffect(() => {
    active.current = true
    failures.current = 0
    urlRef.current = url
    let timer: ReturnType<typeof setTimeout> | undefined

    // 递归 setTimeout 而非 setInterval:下一发从「上一发结束」起算,天然不重叠。
    // 隐藏标签页只暂停请求,回到前台后下一次 tick 立即恢复。
    const tick = async () => {
      if (!document.hidden) await refresh()
      if (!active.current) return
      const backoff = Math.min(2 ** failures.current, MAX_BACKOFF_FACTOR)
      timer = setTimeout(tick, intervalMs * backoff)
    }
    void tick()

    return () => {
      active.current = false
      if (timer) clearTimeout(timer)
    }
    // url 变化 → run/refresh 已重建,effect 重跑并把 urlRef 指向新值;
    // 旧 url 的在飞响应在 run 内按 urlRef 过期丢弃
  }, [refresh, intervalMs, url])

  return { data, error, loading, refresh }
}
