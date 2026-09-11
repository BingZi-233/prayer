"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { usePolling } from "@/components/admin/use-polling"
import type { Data } from "./types"

/**
 * reflection 页的数据、派生计数与三个动作。
 *
 * 三者互不依赖:compact 用 busy,autoPromote 用 promoteBusy,act 用 acting(各管各的
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
  const [busy, setBusy] = useState(false)
  const [promoteBusy, setPromoteBusy] = useState(false)
  const [acting, setActing] = useState<number | null>(null)
  // 3s 轮询 + 操作都会触发 render:计数只随数据变化重算
  const { entryCount, approvedCount } = useMemo(() => {
    const es = d?.entries ?? []
    return {
      entryCount: es.length,
      approvedCount: es.filter((e) => (e.status ?? "approved") === "approved")
        .length,
    }
  }, [d])
  const willCompact = d ? approvedCount >= d.config.compactMinEntries : false
  const willPromote = d
    ? approvedCount >= d.config.promoteMinEntries && d.config.promoteMs > 0
    : false

  async function compact() {
    setBusy(true)
    try {
      const r = await fetch("/api/reflection/compact", { method: "POST" }).then(
        (x) => x.json()
      )
      if (r.ok) {
        toast.success(
          r.data.ran
            ? `已整理:${r.data.before} → ${r.data.after} 条`
            : "整理完成:无变化(未达阈值或结果不变)"
        )
      } else {
        toast.error(`整理失败:${r.error}`)
      }
    } catch (e) {
      toast.error(`整理失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await refresh({ force: true })
      setBusy(false)
    }
  }

  async function autoPromote() {
    setPromoteBusy(true)
    try {
      const r = await fetch("/api/reflection/promote", { method: "POST" }).then(
        (x) => x.json()
      )
      if (r.ok) {
        toast.success(
          r.data.promoted > 0
            ? `自动升格:评审 ${r.data.considered} 条,升格 ${r.data.promoted} 条`
            : `升格评审完成:候选 ${r.data.considered} 条,无需升格`
        )
      } else {
        toast.error(`升格失败:${r.error}`)
      }
    } catch (e) {
      toast.error(`升格失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await refresh({ force: true })
      setPromoteBusy(false)
    }
  }

  async function act(id: number, action: "approve" | "reject" | "promote") {
    setActing(id)
    try {
      const r = await fetch("/api/reflection", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      }).then((x) => x.json())
      if (r.ok) {
        if (action === "promote")
          toast.success(`已升格为正式文档：${r.data.file}`)
        else toast.success(action === "approve" ? "已恢复入库" : "已驳回")
        await refresh({ force: true })
      } else toast.error(r.error || "操作失败")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(null)
    }
  }

  return {
    data: d,
    error,
    loading,
    refresh,
    busy,
    promoteBusy,
    acting,
    entryCount,
    approvedCount,
    willCompact,
    willPromote,
    compact,
    autoPromote,
    act,
  }
}
