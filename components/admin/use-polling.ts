"use client"

import { useCallback, useEffect, useState } from "react"

// 统一轮询数据 hook:折叠各页手写的 setInterval+fetch+错误处理。
// 返回 { data, error, loading, refresh }。首次响应前 loading=true;
// 之后轮询静默更新(不翻回 loading,避免每 3 秒闪骨架)。
export function usePolling<T>(url: string, intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(url).then((x) => x.json())
      if (r.ok) {
        setData(r.data as T)
        setError(null)
      } else {
        setError(r.error ?? "加载失败")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误")
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, intervalMs)
    return () => clearInterval(t)
  }, [refresh, intervalMs])

  return { data, error, loading, refresh }
}
