"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { usePolling } from "@/components/admin/use-polling"
import { fetchApi } from "@/lib/core/http-client"
import type { Data } from "./types"
import { runReflectionAction } from "./request-action"

/**
 * reflection 页的数据、派生计数与两个动作。
 *
 * 两者互不依赖:autoPromote 用 promoteBusy,act 用 acting(各管各的
 * 「正在操作哪一行」的锁,彼此不读对方的状态)。共享的只有 /api/reflection 这一份
 * 轮询数据与 refresh —— 所以整体收进一个 hook,不必按动作再拆。
 */
export function useReflectionActions() {
  const {
    data: d,
    error,
    loading,
    refresh,
  } = usePolling<Data>("/api/reflection")
  const [promoteBusy, setPromoteBusy] = useState(false)
  const [acting, setActing] = useState<number | null>(null)
  const lifecycle = useRef<AbortController | null>(null)
  useEffect(() => {
    // StrictMode 会先清理再重新装配;每次装配都创建新的控制器。
    const controller = new AbortController()
    lifecycle.current = controller
    return () => controller.abort()
  }, [])
  // 3s 轮询 + 操作都会触发 render:计数只随数据变化重算
  const approvedCount = useMemo(
    () =>
      (d?.entries ?? []).filter((e) => (e.status ?? "approved") === "approved")
        .length,
    [d]
  )
  const willPromote = d
    ? approvedCount >= d.config.promoteMinEntries && d.config.promoteMs > 0
    : false

  async function autoPromote() {
    const controller = lifecycle.current
    if (!controller || controller.signal.aborted) return
    setPromoteBusy(true)
    try {
      const r = await runReflectionAction<{
        considered: number
        promoted: number
      }>(
        "/api/reflection/promote",
        { method: "POST" },
        () => {
          if (!controller.signal.aborted)
            toast.info("升格任务已提交，正在等待结果。")
        },
        controller.signal
      )
      if (controller.signal.aborted) return
      if (r.ok) {
        toast.success(
          r.data.promoted > 0
            ? `自动升格:评审 ${r.data.considered} 条,升格 ${r.data.promoted} 条`
            : `升格评审完成:候选 ${r.data.considered} 条,无需升格`
        )
      } else {
        toast.error(
          `${r.outcomeUnknown ? "升格结果待确认" : "升格失败"}:${r.error}`
        )
      }
    } catch (e) {
      if (!controller.signal.aborted)
        toast.error(`升格失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (!controller.signal.aborted) {
        await refresh({ force: true })
        if (!controller.signal.aborted) setPromoteBusy(false)
      }
    }
  }

  async function act(id: number, action: "approve" | "reject" | "promote") {
    const controller = lifecycle.current
    if (!controller || controller.signal.aborted) return
    setActing(id)
    try {
      const init = {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      }
      const r =
        action === "promote"
          ? await runReflectionAction<{ file: string }>(
              "/api/reflection",
              init,
              () => {
                if (!controller.signal.aborted)
                  toast.info("升格任务已提交，正在等待结果。")
              },
              controller.signal
            )
          : await fetchApi<{ file?: string }>("/api/reflection", {
              ...init,
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(30_000),
              ]),
            })
      if (controller.signal.aborted) return
      if (r.ok) {
        if (action === "promote")
          toast.success(`已升格为正式文档：${r.data.file}`)
        else toast.success(action === "approve" ? "已恢复入库" : "已驳回")
        await refresh({ force: true })
      } else toast.error(r.error || "操作失败")
    } catch (e) {
      if (!controller.signal.aborted)
        toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      if (!controller.signal.aborted) setActing(null)
    }
  }

  return {
    data: d,
    error,
    loading,
    refresh,
    promoteBusy,
    acting,
    approvedCount,
    willPromote,
    autoPromote,
    act,
  }
}
