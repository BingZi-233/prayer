import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { createSessionListCoordinator } from "@/components/admin/session-polling"
import { useGroupNames, useMemberNames } from "@/lib/core/chat/group-name"
import type { Sess, Msg, Filter } from "./types"

const POLL_MS = 4000

export function useSessionSelection() {
  const router = useRouter()
  const params = useSearchParams()
  const [sessions, setSessions] = useState<Sess[] | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState<Filter>(() => {
    if (params.get("human") === "1") return "human"
    if (params.get("active") === "1") return "active"
    return "all"
  })
  const [showTools, setShowTools] = useState(false)

  const activeKeyRef = useRef<string | null>(null)
  const activeUpdatedAtRef = useRef<number | null>(null)
  const sessionsRef = useRef<Sess[] | null>(null)
  const mountedRef = useRef(false)
  const isMounted = useCallback(() => mountedRef.current, [])
  const commitSessions = useCallback((next: Sess[] | null) => {
    if (next) {
      sessionsRef.current = next
      setSessions(next)
    }
  }, [])
  const filterRef = useRef(filter)
  const transcriptGenRef = useRef(0)
  const lastHandledUrlKeyRef = useRef<string | null | undefined>(undefined)
  const writingUrlKeyRef = useRef<string | null>(null)

  const { label } = useGroupNames()
  const memberName = useMemberNames((sessions ?? []).map((s) => s.key))

  const keyLabel = useCallback(
    (key: string) => {
      const base = label(key)
      const nick = memberName(key)
      if (!nick) return base
      const sep = " · "
      const i = base.lastIndexOf(sep)
      if (i < 0) return `${base}${sep}${nick}`
      return `${base.slice(0, i)}${sep}${nick}`
    },
    [memberName, label]
  )

  const syncUrl = useCallback(
    (key: string | null, nextFilter: Filter) => {
      writingUrlKeyRef.current = key
      lastHandledUrlKeyRef.current = key
      const sp = new URLSearchParams()
      if (key) sp.set("key", key)
      if (nextFilter === "human") sp.set("human", "1")
      if (nextFilter === "active") sp.set("active", "1")
      const q = sp.toString()
      router.replace(q ? `/admin/sessions?${q}` : "/admin/sessions", {
        scroll: false,
      })
    },
    [router]
  )

  const loadTranscript = useCallback(
    async (sessionId: string, gen: number, forKey: string) => {
      try {
        const r = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}`
        ).then((x) => x.json())
        if (transcriptGenRef.current !== gen || activeKeyRef.current !== forKey)
          return
        if (r.ok && mountedRef.current) setMsgs(r.data as Msg[])
      } catch {
        /* 保持旧 msgs 或空 */
      } finally {
        if (
          transcriptGenRef.current === gen &&
          activeKeyRef.current === forKey
        ) {
          if (mountedRef.current) setLoading(false)
        }
      }
    },
    []
  )

  const openSession = useCallback(
    (sess: Sess, opts: { pushUrl?: boolean; forceReload?: boolean } = {}) => {
      const { pushUrl = true, forceReload = false } = opts
      if (!sess.sessionId) {
        toast.message("无对话记录", {
          description: "该会话尚无对话记录（可能刚创建或已过期）。",
        })
        return
      }
      if (!forceReload && activeKeyRef.current === sess.key) {
        if (pushUrl) syncUrl(sess.key, filterRef.current)
        return
      }
      activeKeyRef.current = sess.key
      activeUpdatedAtRef.current = sess.updatedAt
      setActive(sess.key)
      if (pushUrl) syncUrl(sess.key, filterRef.current)
      const gen = ++transcriptGenRef.current
      setLoading(true)
      setMsgs([])
      void loadTranscript(sess.sessionId, gen, sess.key)
    },
    [loadTranscript, syncUrl]
  )

  const closeSession = useCallback(() => {
    activeKeyRef.current = null
    setActive(null)
    syncUrl(null, filterRef.current)
  }, [syncUrl])

  const refreshActiveTranscript = useCallback(async (list: Sess[] | null) => {
    try {
      if (!list || !mountedRef.current) return
      const key = activeKeyRef.current
      if (!key) return
      const s = list.find((x) => x.key === key)
      if (!s?.sessionId || activeUpdatedAtRef.current === s.updatedAt) return
      activeUpdatedAtRef.current = s.updatedAt
      const gen = ++transcriptGenRef.current
      const tr = await fetch(
        `/api/sessions/${encodeURIComponent(s.sessionId)}`
      ).then((x) => x.json())
      if (
        mountedRef.current &&
        transcriptGenRef.current === gen &&
        activeKeyRef.current === key &&
        tr.ok
      ) {
        setMsgs(tr.data as Msg[])
      }
    } catch {
      /* 静默 */
    }
  }, [])

  /* eslint-disable react-hooks/refs */
  const sessionCoordinator = useMemo(
    () =>
      createSessionListCoordinator(
        async (): Promise<Sess[] | null> => {
          const r = await fetch("/api/sessions").then((x) => x.json())
          if (r.ok) return r.data as Sess[]
          return null
        },
        isMounted,
        commitSessions,
        { intervalMs: POLL_MS },
        refreshActiveTranscript
      ),
    [commitSessions, isMounted, refreshActiveTranscript]
  )
  /* eslint-enable react-hooks/refs */
  const loadSessions = sessionCoordinator.loadSessions

  const paramKey = params.get("key")
  useEffect(() => {
    if (writingUrlKeyRef.current != null) {
      if (paramKey === writingUrlKeyRef.current) {
        writingUrlKeyRef.current = null
      }
      return
    }
    if (paramKey === lastHandledUrlKeyRef.current) return
    lastHandledUrlKeyRef.current = paramKey
    if (!paramKey) return
    if (activeKeyRef.current === paramKey) return
    const list = sessionsRef.current
    if (!list) return
    const s = list.find((x) => x.key === paramKey)
    if (s) openSession(s, { pushUrl: false })
  }, [paramKey, openSession])

  useEffect(() => {
    if (!sessions?.length) return
    if (writingUrlKeyRef.current != null) return
    const key = paramKey
    if (!key) return
    if (activeKeyRef.current === key) return
    if (lastHandledUrlKeyRef.current === key && activeKeyRef.current) return
    const s = sessions.find((x) => x.key === key)
    if (s) {
      lastHandledUrlKeyRef.current = key
      openSession(s, { pushUrl: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  useEffect(() => {
    mountedRef.current = true
    const poller = sessionCoordinator.poller
    poller.start()
    return () => {
      mountedRef.current = false
      poller.stop()
    }
  }, [sessionCoordinator])

  async function refresh() {
    setRefreshing(true)
    try {
      const list = await loadSessions()
      const key = activeKeyRef.current
      if (key && list) {
        const s = list.find((x) => x.key === key)
        if (s?.sessionId) {
          activeUpdatedAtRef.current = s.updatedAt
          const gen = ++transcriptGenRef.current
          setLoading(true)
          await loadTranscript(s.sessionId, gen, key)
        }
      }
    } finally {
      setRefreshing(false)
    }
  }

  function setFilterAndUrl(f: Filter) {
    setFilter(f)
    filterRef.current = f
    syncUrl(activeKeyRef.current, f)
  }

  const activeSess = useMemo(
    () => (sessions ?? []).find((s) => s.key === active) ?? null,
    [sessions, active]
  )

  const stats = useMemo(() => {
    const all = sessions ?? []
    return {
      total: all.length,
      active: all.filter((s) => s.active).length,
      human: all.filter((s) => s.humanMode).length,
    }
  }, [sessions])

  const list = useMemo(() => {
    let base = sessions ?? []
    if (filter === "human") base = base.filter((s) => s.humanMode)
    else if (filter === "active") base = base.filter((s) => s.active)
    return [...base].sort((a, b) => {
      if (!!b.humanMode !== !!a.humanMode) return a.humanMode ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [sessions, filter])

  const shown = useMemo(() => {
    if (!deferredQuery.trim()) return list
    const q = deferredQuery.toLowerCase()
    return list.filter(
      (s) =>
        s.key.toLowerCase().includes(q) ||
        keyLabel(s.key).toLowerCase().includes(q) ||
        (s.lastQuestion ?? "").toLowerCase().includes(q)
    )
  }, [list, deferredQuery, keyLabel])

  const visibleMsgs = useMemo(
    () => (showTools ? msgs : msgs.filter((m) => m.role !== "tool")),
    [msgs, showTools]
  )

  const toolCount = useMemo(
    () => msgs.filter((m) => m.role === "tool").length,
    [msgs]
  )

  const lastBotText = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && msgs[i].text) return msgs[i].text!
    }
    return null
  }, [msgs])

  return {
    sessions,
    msgs,
    active,
    loading,
    refreshing,
    query,
    setQuery,
    filter,
    showTools,
    setShowTools,
    openSession,
    closeSession,
    refresh,
    setFilterAndUrl,
    activeSess,
    stats,
    list,
    shown,
    visibleMsgs,
    toolCount,
    lastBotText,
    keyLabel,
    loadSessions,
  }
}
